import { browser } from "wxt/browser"
import { defineBackground } from "wxt/utils/define-background"
import { apiFetch } from "@/lib/api"
import { isTestConnectionMessage, testConnection } from "@/lib/connection"
import { siteKey } from "@/lib/detect/ats"
import { createFrameTracker, type FrameTracker } from "@/lib/detect/frames"
import { createFillRequestHandler } from "@/lib/fill-request"
import { createFillService } from "@/lib/fill-service"
import { createLearningRecordHandler } from "@/lib/learning-record"
import {
  type FillMessage,
  isDisableSiteMessage,
  isFillFramesMessage,
  isFillReportMessage,
  isFormDetectedMessage,
  isFrameNavigatedMessage,
  isOpenOptionsMessage,
  isProbeFramesMessage,
  isSiteDisabledMessage,
  type SiteDisabledResponse,
} from "@/lib/messages"
import { createNextJobHandler } from "@/lib/next-job"
import { disableNextJobOffers, disableSite, getDisabledSites, getNoNextJobSites } from "@/lib/storage"

const BADGE_MS = 3000
const NO_RECEIVER = "Receiving end does not exist"

async function setBadge(text: string): Promise<void> {
  try {
    await browser.action.setBadgeText({ text })
  } catch {
    // the badge is best effort and must never replace the error it reports
  }
}

function flashBadge(text: string): void {
  void setBadge(text)
  setTimeout(() => void setBadge(""), BADGE_MS)
}

let tracker: FrameTracker | null = null

function frames(): FrameTracker {
  tracker ??= createFrameTracker(browser.storage.session)
  return tracker
}

async function requestFill(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true })
  if (tab?.id === undefined) return
  const message: FillMessage = { type: "fill" }
  try {
    await browser.tabs.sendMessage(tab.id, message, { frameId: 0 })
  } catch (error) {
    flashBadge("!")
    if (!(error instanceof Error && error.message.includes(NO_RECEIVER))) throw error
  }
  await fillChildFrames(tab.id)
}

async function fillChildFrames(tabId: number): Promise<void> {
  const message: FillMessage = { type: "fill", skipTop: true }
  for (const { frameId, documentId } of await frames().fillTargets(tabId)) {
    toTab(tabId, message, documentId ? { frameId, documentId } : { frameId })
  }
}

async function hideStorageFromContentScripts(): Promise<void> {
  // local holds the token, session holds the frame records and the pending next job offers
  for (const area of [browser.storage.local, browser.storage.session]) {
    if (typeof area.setAccessLevel !== "function") continue
    try {
      await area.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
    } catch (error) {
      console.error("[skiffr] could not restrict storage access", error)
    }
  }
}

async function isTrustedFrame(tabId: number, frameId: number, documentId: string | undefined): Promise<boolean> {
  const targets = await frames().fillTargets(tabId)
  return targets.some(
    (target) => target.frameId === frameId && (!target.documentId || target.documentId === documentId),
  )
}

function toTab(tabId: number, message: unknown, options?: Browser.tabs.MessageSendOptions): void {
  browser.tabs.sendMessage(tabId, message, options).catch(() => {})
}

async function relayChildReports(tabId: number): Promise<void> {
  if (await frames().hasTrustedFrame(tabId)) toTab(tabId, { type: "form-detected" }, { frameId: 0 })
}

type FrameSender = { tabId: number; frameId: number; url: string; documentId?: string; origin?: string }

async function handleFrameMessage(message: unknown, { tabId, frameId, url, documentId, origin }: FrameSender) {
  if (frameId !== 0) {
    if (isFillReportMessage(message)) {
      // only a frame that was told to fill may speak for the page, the top frame shows the one result
      if (await isTrustedFrame(tabId, frameId, documentId)) toTab(tabId, message, { frameId: 0 })
      return
    }
    if (isFrameNavigatedMessage(message)) {
      const had = await frames().hasTrustedFrame(tabId)
      await frames().drop(tabId, frameId)
      // the toast was offered for a form in a frame that is gone, the top frame decides whether it still stands
      if (had && !(await frames().hasTrustedFrame(tabId))) toTab(tabId, { type: "child-forms-gone" }, { frameId: 0 })
    } else if (
      isFormDetectedMessage(message) &&
      (await frames().report(tabId, frameId, { url, documentId, origin })) === "new"
    ) {
      await relayChildReports(tabId)
    }
    return
  }
  if (isProbeFramesMessage(message)) {
    // a new top document ends every frame reported so far, children are asked to report again
    if ((await frames().startTop(tabId, url, documentId)) === "new-document") toTab(tabId, { type: "report-again" })
    else await relayChildReports(tabId)
  } else if (isFillFramesMessage(message)) {
    await frames().setTop(tabId, url)
    await fillChildFrames(tabId)
  } else if (isOpenOptionsMessage(message)) {
    await browser.runtime.openOptionsPage()
  } else if (isDisableSiteMessage(message)) {
    const key = siteKey(url)
    if (key) await disableSite(key)
  }
}

function handleContentMessage(
  message: unknown,
  sender: Browser.runtime.MessageSender,
  sendResponse: (response: SiteDisabledResponse) => void,
): boolean {
  const tabId = sender.tab?.id
  if (tabId === undefined || sender.frameId === undefined || !sender.url) return false
  if (sender.documentLifecycle && sender.documentLifecycle !== "active") return false
  if (sender.frameId === 0 && isSiteDisabledMessage(message)) {
    const key = siteKey(sender.url)
    getDisabledSites()
      .then((sites) => sendResponse({ disabled: key !== null && sites.includes(key) }))
      .catch(() => sendResponse({ disabled: false }))
    return true
  }
  handleFrameMessage(message, {
    tabId,
    frameId: sender.frameId,
    url: sender.url,
    documentId: sender.documentId,
    origin: sender.origin,
  }).catch((error) => {
    console.error("[skiffr] frame message failed", error)
  })
  return false
}

export default defineBackground(() => {
  const fillService = createFillService({ call: (run) => apiFetch(run) })
  const fillRequests = createFillRequestHandler({
    extensionId: browser.runtime.id,
    extensionUrl: browser.runtime.getURL("/"),
    service: fillService,
    isTrustedFrame,
  })
  const learningRecords = createLearningRecordHandler({
    extensionId: browser.runtime.id,
    extensionUrl: browser.runtime.getURL("/"),
    call: (run) => apiFetch(run),
    isTrustedFrame,
  })
  const nextJobs = createNextJobHandler({
    extensionId: browser.runtime.id,
    extensionUrl: browser.runtime.getURL("/"),
    call: (run) => apiFetch(run),
    isTrustedFrame,
    topUrl: (tabId) => frames().topUrl(tabId),
    storage: browser.storage.session,
    isMuted: async (site) => (await getNoNextJobSites()).includes(site),
    mute: disableNextJobOffers,
    open: async (url, windowId) => {
      await browser.tabs.create({ url, active: true, ...(windowId === undefined ? {} : { windowId }) })
    },
    offer: (tabId, message) => toTab(tabId, message, { frameId: 0 }),
  })
  browser.runtime.onMessage.addListener(handleContentMessage)
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const pending = fillRequests.handle(message, sender)
    if (!pending) return false
    pending.then(sendResponse, () => sendResponse({ ok: false, code: "failed" }))
    return true
  })
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const pending = learningRecords.handle(message, sender)
    if (!pending) return false
    pending.then(sendResponse, () => sendResponse({ ok: false, code: "failed" }))
    return true
  })
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const pending = nextJobs.handle(message, sender)
    if (!pending) return false
    pending.then(sendResponse, () => sendResponse({ ok: false, code: "failed" }))
    return true
  })
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) fillService.clear()
  })
  browser.tabs.onRemoved.addListener((tabId) => {
    fillRequests.forgetTab(tabId)
    learningRecords.forgetTab(tabId)
    void nextJobs.forgetTab(tabId)
    void frames().reset(tabId)
  })
  browser.commands.onCommand.addListener((command) => {
    if (command === "fill") return requestFill()
  })
  browser.runtime.onMessage.addListener((message, sender) => {
    // Extension pages only: a content script reports its web page's url as sender.url and never gets to use the token.
    if (
      isTestConnectionMessage(message) &&
      sender.id === browser.runtime.id &&
      sender.url?.startsWith(browser.runtime.getURL("/"))
    ) {
      return testConnection()
    }
  })
  void setBadge("")
  void hideStorageFromContentScripts()
})
