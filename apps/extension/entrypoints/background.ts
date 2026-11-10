import { browser } from "wxt/browser"
import { defineBackground } from "wxt/utils/define-background"
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

async function requestFill(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true })
  if (tab?.id === undefined) return
  const message: FillMessage = { type: "fill" }
  try {
    await browser.tabs.sendMessage(tab.id, message)
  } catch (error) {
    flashBadge("!")
    if (!(error instanceof Error && error.message.includes(NO_RECEIVER))) throw error
  }
}

async function hideStorageFromContentScripts(): Promise<void> {
  if (typeof browser.storage.local.setAccessLevel !== "function") return
  try {
    await browser.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  } catch (error) {
    console.error("[skiffr] could not restrict storage access", error)
  }
}

function hostnameOf(sender: Browser.runtime.MessageSender): string | null {
  if (sender.frameId !== 0 || !sender.url) return null
  try {
    return new URL(sender.url).hostname
  } catch {
    return null
  }
}

function toTab(tabId: number, message: unknown, options?: Browser.tabs.MessageSendOptions): void {
  browser.tabs.sendMessage(tabId, message, options).catch(() => {})
}

function handleContentMessage(
  message: unknown,
  sender: Browser.runtime.MessageSender,
  sendResponse: (response: SiteDisabledResponse) => void,
): boolean {
  const tabId = sender.tab?.id
  if (tabId === undefined) return false
  if (isFormDetectedMessage(message) && sender.frameId !== 0) {
    toTab(tabId, message, { frameId: 0 })
  } else if (sender.frameId !== 0) {
    return false
  } else if (isProbeFramesMessage(message)) {
    toTab(tabId, { type: "report-form" })
  } else if (isFillFramesMessage(message)) {
    toTab(tabId, { type: "fill", skipTop: true } satisfies FillMessage)
  } else if (isSiteDisabledMessage(message)) {
    const hostname = hostnameOf(sender)
    getDisabledSites()
      .then((sites) => sendResponse({ disabled: hostname !== null && sites.includes(hostname) }))
      .catch(() => sendResponse({ disabled: false }))
    return true
  } else if (isDisableSiteMessage(message)) {
    const hostname = hostnameOf(sender)
    if (hostname) void disableSite(hostname)
  }
  return false
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(handleContentMessage)
  browser.commands.onCommand.addListener((command) => {
    if (command === "fill") return requestFill()
  })
  void setBadge("")
  void hideStorageFromContentScripts()
})
