import { browser } from "wxt/browser"
import { defineBackground } from "wxt/utils/define-background"
import type { FillMessage } from "@/lib/messages"

const BADGE_MS = 3000
const NO_RECEIVER = "Receiving end does not exist"

function flashBadge(text: string): void {
  browser.action.setBadgeText({ text })
  setTimeout(() => browser.action.setBadgeText({ text: "" }), BADGE_MS)
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

export default defineBackground(() => {
  browser.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  browser.commands.onCommand.addListener((command) => {
    if (command === "fill") return requestFill()
  })
})
