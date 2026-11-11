import { browser } from "wxt/browser"
import { defineContentScript } from "wxt/utils/define-content-script"
import { createRateLimiter } from "@/lib/detect/rate-limit"
import { createFormWatcher } from "@/lib/detect/watch"
import { noteFill } from "@/lib/dev-hook"
import { handleFill } from "@/lib/fill-handler"
import {
  type DisableSiteMessage,
  type FillFramesMessage,
  type FormDetectedMessage,
  type FrameNavigatedMessage,
  isChildFormsGoneMessage,
  isFillMessage,
  isFormDetectedMessage,
  isReportAgainMessage,
  type ProbeFramesMessage,
  type SiteDisabledMessage,
  type SiteDisabledResponse,
} from "@/lib/messages"
import { INITIAL_TOAST_STATE, reduceToast, type ToastEvent } from "@/lib/toast/state"
import { createToastView } from "@/lib/toast/view"

type NavigationTarget = { addEventListener: (type: "navigatesuccess", listener: () => void) => void }

const allowFormDetected = createRateLimiter(3, 5_000)
const allowFrameNavigated = createRateLimiter(10, 5_000)

function fillHere(): void {
  void handleFill()
  noteFill(document)
}

type Outgoing =
  | FormDetectedMessage
  | FrameNavigatedMessage
  | ProbeFramesMessage
  | FillFramesMessage
  | DisableSiteMessage

function send(message: Outgoing): void {
  if (message.type === "form-detected" && !allowFormDetected()) return
  if (message.type === "frame-navigated" && !allowFrameNavigated()) return
  browser.runtime.sendMessage(message).catch(() => {})
}

export default defineContentScript({
  matches: ["<all_urls>"],
  allFrames: true,
  main(ctx) {
    const isTop = window === window.top
    let formInChildFrame = false
    let formHere = false

    let toastState = INITIAL_TOAST_STATE
    const view = createToastView(document, {
      onYes: () => dispatch("yes"),
      onNo: () => dispatch("no"),
      onNever: () => dispatch("never"),
      onTimeout: () => dispatch("timeout"),
    })

    function dispatch(event: ToastEvent): void {
      const step = reduceToast(toastState, event)
      toastState = step.state
      for (const effect of step.effects) {
        if (effect === "show") view.show()
        else if (effect === "hide") view.hide()
        else if (effect === "neverAsk") send({ type: "disable-site" })
        else {
          fillHere()
          if (formInChildFrame) send({ type: "fill-frames" })
        }
      }
    }

    function checkSite(): Promise<void> {
      return browser.runtime
        .sendMessage<SiteDisabledMessage, SiteDisabledResponse | undefined>({ type: "site-disabled" })
        .then((response) => {
          if (response?.disabled) dispatch("blocked")
        })
        .catch(() => {})
    }

    let siteChecked: Promise<void> = isTop ? checkSite() : Promise.resolve()

    function onFormHere(): void {
      formHere = true
      if (isTop) void siteChecked.then(() => dispatch("detected"))
      else send({ type: "form-detected" })
    }

    const watcher = createFormWatcher({ doc: document, onDetect: onFormHere })
    // a new document replaces whatever this frame reported before, so the old record goes first
    if (!isTop) send({ type: "frame-navigated" })
    watcher.start()
    ctx.onInvalidated(() => watcher.stop())
    ctx.addEventListener(document, "click", () => watcher.rearm(), { capture: true, passive: true })

    let lastHref = location.href
    const navigation = (window as unknown as { navigation?: NavigationTarget }).navigation
    navigation?.addEventListener("navigatesuccess", () => {
      if (location.href === lastHref) return
      lastHref = location.href
      formInChildFrame = false
      formHere = false
      dispatch("navigated")
      if (!isTop) send({ type: "frame-navigated" })
      watcher.start()
      if (isTop) send({ type: "probe-frames" })
    })

    // the same top document came back (back/forward cache) or became visible (prerender): no new script start
    // announces it, so start over for this document and have the frames report again
    function restart(): void {
      formInChildFrame = false
      formHere = false
      dispatch("navigated")
      watcher.start()
      send({ type: "probe-frames" })
    }

    if (isTop) {
      window.addEventListener("pageshow", (event) => {
        if (event.persisted) restart()
      })
      if ((document as Document & { prerendering?: boolean }).prerendering) {
        document.addEventListener(
          "prerenderingchange",
          () => {
            siteChecked = checkSite()
            restart()
          },
          { once: true },
        )
      }
    }

    browser.runtime.onMessage.addListener((message: unknown) => {
      if (isFillMessage(message)) {
        if (message.skipTop && isTop) return
        fillHere()
        if (isTop) dispatch("filled")
      } else if (isTop && isFormDetectedMessage(message)) {
        formInChildFrame = true
        void siteChecked.then(() => dispatch("detected"))
      } else if (isTop && isChildFormsGoneMessage(message)) {
        formInChildFrame = false
        if (!formHere) dispatch("navigated")
      } else if (!isTop && isReportAgainMessage(message) && formHere) {
        send({ type: "form-detected" })
      }
    })

    if (isTop) send({ type: "probe-frames" })
  },
})
