import { browser } from "wxt/browser"
import { defineContentScript } from "wxt/utils/define-content-script"
import { isFillMessage } from "@/lib/messages"

export default defineContentScript({
  matches: ["<all_urls>"],
  main() {
    if (import.meta.env.DEV) console.debug("[skiffr] content script loaded")
    browser.runtime.onMessage.addListener((message: unknown) => {
      if (import.meta.env.DEV && isFillMessage(message)) console.debug("[skiffr] fill requested")
    })
  },
})
