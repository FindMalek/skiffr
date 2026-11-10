import { browser } from "wxt/browser"
import { defineBackground } from "wxt/utils/define-background"
import { isTestConnectionMessage, testConnection } from "@/lib/connection"
import type { FillMessage } from "@/lib/messages"

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

export default defineBackground(() => {
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
