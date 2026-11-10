import { browser } from "wxt/browser"
import { defineBackground } from "wxt/utils/define-background"
import { siteKey } from "@/lib/detect/ats"
import { createFrameTracker, type FrameTracker } from "@/lib/detect/frames"
import {
  type FillMessage,
  isDisableSiteMessage,
  isFillFramesMessage,
  isFormDetectedMessage,
  isProbeFramesMessage,
  isSiteDisabledMessage,
  type SiteDisabledResponse,
} from "@/lib/messages"
import { disableSite, getDisabledSites } from "@/lib/storage"

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
  for (const frameId of await frames().trustedFrames(tabId)) toTab(tabId, message, { frameId })
}

async function hideStorageFromContentScripts(): Promise<void> {
  if (typeof browser.storage.local.setAccessLevel !== "function") return
  try {
    await browser.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  } catch (error) {
    console.error("[skiffr] could not restrict storage access", error)
  }
}

function toTab(tabId: number, message: unknown, options?: Browser.tabs.MessageSendOptions): void {
  browser.tabs.sendMessage(tabId, message, options).catch(() => {})
}

async function relayChildReports(tabId: number): Promise<void> {
  if ((await frames().trustedFrames(tabId)).length > 0) toTab(tabId, { type: "form-detected" }, { frameId: 0 })
}

async function handleFrameMessage(message: unknown, tabId: number, frameId: number, url: string, documentId?: string) {
  if (frameId !== 0) {
    if (isFormDetectedMessage(message) && (await frames().report(tabId, frameId, url, documentId)) === "new") {
      await relayChildReports(tabId)
    }
    return
  }
  if (isProbeFramesMessage(message)) {
    await frames().setTop(tabId, url)
    await relayChildReports(tabId)
  } else if (isFillFramesMessage(message)) {
    await frames().setTop(tabId, url)
    await fillChildFrames(tabId)
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
  if (sender.frameId === 0 && isSiteDisabledMessage(message)) {
    const key = siteKey(sender.url)
    getDisabledSites()
      .then((sites) => sendResponse({ disabled: key !== null && sites.includes(key) }))
      .catch(() => sendResponse({ disabled: false }))
    return true
  }
  handleFrameMessage(message, tabId, sender.frameId, sender.url, sender.documentId).catch((error) => {
    console.error("[skiffr] frame message failed", error)
  })
  return false
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(handleContentMessage)
  browser.tabs.onRemoved.addListener((tabId) => void frames().reset(tabId))
  browser.commands.onCommand.addListener((command) => {
    if (command === "fill") return requestFill()
  })
  void setBadge("")
  void hideStorageFromContentScripts()
})
