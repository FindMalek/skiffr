import { browser } from "wxt/browser"
import { defineContentScript } from "wxt/utils/define-content-script"
import { isFillMessage } from "@/lib/messages"

export default defineContentScript({
  matches: ["<all_urls>"],
  main() {
    console.log("[skiffr] content script loaded", location.href)
    browser.runtime.onMessage.addListener((message: unknown) => {
      if (isFillMessage(message)) console.log("[skiffr] fill requested")
    })
  },
})
