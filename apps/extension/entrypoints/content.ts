import { browser } from "wxt/browser"
import { defineContentScript } from "wxt/utils/define-content-script"
import { siteKey } from "@/lib/detect/ats"
import { createRateLimiter } from "@/lib/detect/rate-limit"
import { createFormWatcher } from "@/lib/detect/watch"
import { noteFill } from "@/lib/dev-hook"
import { createWorkerProvider } from "@/lib/fill-client"
import { type FillOutcome, handleFill, setFillObserver, setMappingProvider } from "@/lib/fill-handler"
import { createLearningSession } from "@/lib/learning-session"
import {
  type ApplicationSubmittedMessage,
  type DisableSiteMessage,
  type FillFramesMessage,
  type FillReportMessage,
  type FormDetectedMessage,
  type FrameNavigatedMessage,
  isChildFormsGoneMessage,
  isFillMessage,
  isFillReportMessage,
  isFormDetectedMessage,
  isNextOfferMessage,
  isReportAgainMessage,
  type NextDecisionMessage,
  type NextOfferMessage,
  nextJobResponseSchema,
  type OpenOptionsMessage,
  type ProbeFramesMessage,
  type SiteDisabledMessage,
  type SiteDisabledResponse,
} from "@/lib/messages"
import { type NextOffer, type OfferNote, offerMessage } from "@/lib/toast/offer"
import { type FillTally, resultMessage } from "@/lib/toast/result"
import { INITIAL_TOAST_STATE, reduceToast, type ToastEvent } from "@/lib/toast/state"
import { createToastView } from "@/lib/toast/view"

type NavigationTarget = { addEventListener: (type: "navigatesuccess", listener: () => void) => void }

const allowFormDetected = createRateLimiter(3, 5_000)
const allowFrameNavigated = createRateLimiter(10, 5_000)
const allowSubmitted = createRateLimiter(3, 5_000)

const CHILD_WAIT_MS = 10_000

type Report = Omit<FillReportMessage, "type">

function toReport(outcome: FillOutcome): Report {
  return outcome.ok
    ? {
        filled: outcome.filled,
        review: outcome.review,
        suggested: outcome.suggested,
        ...(outcome.problem ? { problem: outcome.problem } : {}),
      }
    : { filled: 0, review: 0, suggested: 0, problem: outcome.code }
}

type Outgoing =
  | FormDetectedMessage
  | FrameNavigatedMessage
  | ProbeFramesMessage
  | FillFramesMessage
  | DisableSiteMessage
  | FillReportMessage
  | OpenOptionsMessage
  | ApplicationSubmittedMessage

function send(message: Outgoing): void {
  if (message.type === "form-detected" && !allowFormDetected()) return
  if (message.type === "frame-navigated" && !allowFrameNavigated()) return
  if (message.type === "application-submitted" && !allowSubmitted()) return
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
    const learning = createLearningSession({
      send: (message) => browser.runtime.sendMessage(message),
      onSubmitted: () => {
        const site = siteKey(location.href)
        if (site) send({ type: "application-submitted", siteKey: site })
      },
    })
    setFillObserver(learning.begin)
    ctx.onInvalidated(() => learning.stop())

    let toastState = INITIAL_TOAST_STATE
    const view = createToastView(document, {
      onYes: () => dispatch("yes"),
      onNo: () => dispatch("no"),
      onNever: () => dispatch("never"),
      onTimeout: () => dispatch("timeout"),
      onSettings: () => send({ type: "open-options" }),
      onRetry: () => fillFromTop(),
      onOpenNext: () => void decide("open"),
      onMarkApplied: () => void decide("mark"),
      onStopNext: () => {
        void answerOffer("never")
        offer = null
        view.hide()
      },
    })

    // the next job offer of the worker: what is left to choose, and nothing the page could turn into an address
    let offer: (NextOffer & { id: string }) | null = null

    function answerOffer(action: NextDecisionMessage["action"]): Promise<boolean> {
      if (!offer) return Promise.resolve(false)
      const message: NextDecisionMessage = { type: "next-decision", offerId: offer.id, action }
      return browser.runtime
        .sendMessage(message)
        .then((reply: unknown) => {
          const parsed = nextJobResponseSchema.safeParse(reply)
          return parsed.success && parsed.data.ok
        })
        .catch(() => false)
    }

    function showOffer(note?: OfferNote): void {
      const message = offer ? offerMessage(offer, note) : null
      if (!offer || !message) {
        offer = null
        return
      }
      view.showMessage({ ...message, onClose: () => void answerOffer("dismiss") })
      if (!offer.matched && !offer.next) offer = null
    }

    async function decide(action: "open" | "mark"): Promise<void> {
      if (!offer) return
      const done = await answerOffer(action)
      if (!offer) return
      if (done) offer = action === "open" ? { ...offer, next: null } : { ...offer, matched: null }
      if (action === "open") showOffer(done ? "opened" : "open-failed")
      else showOffer(done ? "marked" : "mark-failed")
    }

    function onNextOffer(message: NextOfferMessage): void {
      offer = { id: message.offerId, matched: message.matched, next: message.next }
      showOffer()
    }

    // one toast tells how the whole page went: this frame's fill and what trusted child frames report
    let tally: FillTally & { children: number } = { filled: 0, review: 0, suggested: 0, children: 0 }
    let childWait: ReturnType<typeof setTimeout> | undefined
    // a start while a fill is running is ignored: two shortcuts, or one during a fill, would double the api calls and the toast
    let filling = false

    function showResult(final = false): void {
      const waiting = formInChildFrame && tally.children === 0 && !final
      const message = resultMessage(tally, waiting)
      if (message) view.showMessage(message)
      else {
        clearTimeout(childWait)
        childWait = setTimeout(() => showResult(true), CHILD_WAIT_MS)
      }
    }

    function addReport(report: Report): void {
      tally.filled += report.filled
      tally.review += report.review
      tally.suggested += report.suggested
      tally.problem ??= report.problem
      showResult()
    }

    async function fillHere(): Promise<void> {
      if (filling) return
      filling = true
      noteFill(document)
      try {
        const report = toReport(await handleFill())
        if (isTop) addReport(report)
        else send({ type: "fill-report", ...report })
      } finally {
        filling = false
      }
    }

    function fillFromTop(withFrames = true): void {
      if (filling) return
      clearTimeout(childWait)
      tally = { filled: 0, review: 0, suggested: 0, children: 0 }
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
      } else if (isTop && isNextOfferMessage(message)) {
        onNextOffer(message)
      } else if (!isTop && isReportAgainMessage(message) && formHere) {
        send({ type: "form-detected" })
      }
    })

    if (isTop) send({ type: "probe-frames" })
  },
})
