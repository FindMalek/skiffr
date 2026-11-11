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

    const siteChecked: Promise<void> = isTop
      ? browser.runtime
          .sendMessage<SiteDisabledMessage, SiteDisabledResponse | undefined>({ type: "site-disabled" })
          .then((response) => {
            if (response?.disabled) dispatch("blocked")
          })
          .catch(() => {})
      : Promise.resolve()

    function onFormHere(): void {
      formHere = true
      if (isTop) void siteChecked.then(() => dispatch("detected"))
      else send({ type: "form-detected" })
    }

    const watcher = createFormWatcher({ doc: document, onDetect: onFormHere })
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

    browser.runtime.onMessage.addListener((message: unknown) => {
      if (isFillMessage(message)) {
        if (message.skipTop && isTop) return
        fillHere()
        if (isTop) dispatch("filled")
      } else if (isTop && isFormDetectedMessage(message)) {
        formInChildFrame = true
        void siteChecked.then(() => dispatch("detected"))
      } else if (!isTop && isReportAgainMessage(message) && formHere) {
        send({ type: "form-detected" })
      }
    })

    if (isTop) send({ type: "probe-frames" })
  },
})
