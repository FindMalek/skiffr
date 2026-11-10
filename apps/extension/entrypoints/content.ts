import { browser } from "wxt/browser"
import { defineContentScript } from "wxt/utils/define-content-script"
import { createFormWatcher } from "@/lib/detect/watch"
import { handleFill } from "@/lib/fill-handler"
import {
  type DisableSiteMessage,
  type FillFramesMessage,
  type FormDetectedMessage,
  isFillMessage,
  isFormDetectedMessage,
  isReportFormMessage,
  type ProbeFramesMessage,
  type SiteDisabledMessage,
  type SiteDisabledResponse,
} from "@/lib/messages"
import { INITIAL_TOAST_STATE, reduceToast, type ToastEvent } from "@/lib/toast/state"
import { createToastView } from "@/lib/toast/view"

type NavigationTarget = { addEventListener: (type: "navigatesuccess", listener: () => void) => void }

function send(message: FormDetectedMessage | ProbeFramesMessage | FillFramesMessage | DisableSiteMessage): void {
  browser.runtime.sendMessage(message).catch(() => {})
}

export default defineContentScript({
  matches: ["<all_urls>"],
  allFrames: true,
  main(ctx) {
    const isTop = window === window.top
    let formHere = false
    let formInChildFrame = false

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
          void handleFill()
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
      formHere = false
      formInChildFrame = false
      dispatch("navigated")
      watcher.start()
    })

    browser.runtime.onMessage.addListener((message: unknown) => {
      if (isFillMessage(message)) {
        if (message.skipTop && isTop) return
        void handleFill()
        if (isTop) dispatch("filled")
      } else if (isTop && isFormDetectedMessage(message)) {
        formInChildFrame = true
        void siteChecked.then(() => dispatch("detected"))
      } else if (!isTop && isReportFormMessage(message) && formHere) {
        send({ type: "form-detected" })
      }
    })

    if (isTop) send({ type: "probe-frames" })
  },
})
