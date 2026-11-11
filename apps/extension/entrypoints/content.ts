import { browser } from "wxt/browser"
import { defineContentScript } from "wxt/utils/define-content-script"
import { createRateLimiter } from "@/lib/detect/rate-limit"
import { createFormWatcher } from "@/lib/detect/watch"
import { noteFill } from "@/lib/dev-hook"
import { createWorkerProvider } from "@/lib/fill-client"
import { FILL_ERROR_ACTIONS, FILL_ERROR_TEXT, type FillErrorCode } from "@/lib/fill-config"
import { type FillOutcome, handleFill, setMappingProvider } from "@/lib/fill-handler"
import {
  type DisableSiteMessage,
  type FillFramesMessage,
  type FillReportMessage,
  type FormDetectedMessage,
  type FrameNavigatedMessage,
  isChildFormsGoneMessage,
  isFillMessage,
  isFillReportMessage,
  isFormDetectedMessage,
  isReportAgainMessage,
  type OpenOptionsMessage,
  type ProbeFramesMessage,
  type SiteDisabledMessage,
  type SiteDisabledResponse,
} from "@/lib/messages"
import { INITIAL_TOAST_STATE, reduceToast, type ToastEvent } from "@/lib/toast/state"
import { createToastView } from "@/lib/toast/view"

type NavigationTarget = { addEventListener: (type: "navigatesuccess", listener: () => void) => void }

const allowFormDetected = createRateLimiter(3, 5_000)
const allowFrameNavigated = createRateLimiter(10, 5_000)

const CHILD_WAIT_MS = 10_000

type Report = Omit<FillReportMessage, "type">

function toReport(outcome: FillOutcome): Report {
  return outcome.ok
    ? { filled: outcome.filled, review: outcome.review, ...(outcome.problem ? { problem: outcome.problem } : {}) }
    : { filled: 0, review: 0, problem: outcome.code }
}

const fields = (n: number) => `${n} ${n === 1 ? "field" : "fields"}`

type Outgoing =
  | FormDetectedMessage
  | FrameNavigatedMessage
  | ProbeFramesMessage
  | FillFramesMessage
  | DisableSiteMessage
  | FillReportMessage
  | OpenOptionsMessage

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

    setMappingProvider(createWorkerProvider((message) => browser.runtime.sendMessage(message)))

    let toastState = INITIAL_TOAST_STATE
    const view = createToastView(document, {
      onYes: () => dispatch("yes"),
      onNo: () => dispatch("no"),
      onNever: () => dispatch("never"),
      onTimeout: () => dispatch("timeout"),
      onSettings: () => send({ type: "open-options" }),
      onRetry: () => fillFromTop(),
    })

    // one toast tells how the whole page went: this frame's fill and what trusted child frames report
    let tally: { filled: number; review: number; problem?: FillErrorCode; children: number } = {
      filled: 0,
      review: 0,
      children: 0,
    }
    let childWait: ReturnType<typeof setTimeout> | undefined

    function showResult(final = false): void {
      const { filled, review, problem } = tally
      if (filled + review === 0 && problem) {
        view.showMessage({ text: FILL_ERROR_TEXT[problem], actions: FILL_ERROR_ACTIONS[problem] })
      } else if (filled + review === 0) {
        if (formInChildFrame && tally.children === 0 && !final) {
          clearTimeout(childWait)
          childWait = setTimeout(() => showResult(true), CHILD_WAIT_MS)
          return
        }
        view.showMessage({ text: "Nothing to fill" })
      } else {
        const need = review === 0 ? "" : review === 1 ? ", 1 needs review" : `, ${review} need review`
        view.showMessage({
          text: `Filled ${fields(filled)}${need}${problem ? ". Some answers could not be loaded." : ""}`,
          actions: problem ? ["retry"] : [],
        })
      }
    }

    function addReport(report: Report): void {
      tally.filled += report.filled
      tally.review += report.review
      tally.problem ??= report.problem
      showResult()
    }

    async function fillHere(): Promise<void> {
      noteFill(document)
      const report = toReport(await handleFill())
      if (isTop) addReport(report)
      else send({ type: "fill-report", ...report })
    }

    function fillFromTop(withFrames = true): void {
      clearTimeout(childWait)
      tally = { filled: 0, review: 0, children: 0 }
      view.showMessage({ text: "Filling your application…", busy: true })
      void fillHere()
      if (withFrames && formInChildFrame) send({ type: "fill-frames" })
    }

    function dispatch(event: ToastEvent): void {
      const step = reduceToast(toastState, event)
      toastState = step.state
      for (const effect of step.effects) {
        if (effect === "show") view.show()
        else if (effect === "hide") view.hide()
        else if (effect === "neverAsk") send({ type: "disable-site" })
        else fillFromTop()
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
        if (isTop) {
          dispatch("filled")
          // the worker fills the child frames itself on this path
          fillFromTop(false)
        } else void fillHere()
      } else if (isTop && isFillReportMessage(message)) {
        tally.children++
        addReport(message)
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
