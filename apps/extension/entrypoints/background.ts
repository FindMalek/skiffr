import { browser } from "wxt/browser"
import { defineBackground } from "wxt/utils/define-background"
import type { FillMessage } from "@/lib/messages"

export default defineBackground(() => {
  browser.commands.onCommand.addListener(async (command) => {
    if (command !== "fill") return
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    if (tab?.id === undefined) return
    const message: FillMessage = { type: "fill" }
    await browser.tabs.sendMessage(tab.id, message).catch(() => undefined)
  })
})
