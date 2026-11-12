import { siteKey } from "./detect/ats"
import { createRateLimiter } from "./detect/rate-limit"
import { REQUEST_LIMIT } from "./fill-config"
import type { FillService } from "./fill-service"
import { type FillResponse, fillRequestMessageSchema } from "./messages"

export type FillSender = {
  id?: string
  url?: string
  frameId?: number
  documentId?: string
  documentLifecycle?: string
  tab?: { id?: number; active?: boolean; windowId?: number }
}

export type FillRequestDeps = {
  extensionId: string
  /** `chrome-extension://<id>/`: a page of the extension itself is never a content script. */
  extensionUrl: string
  service: FillService
  /** Child frames only: whether the frame logic trusts this document enough to read its fields. */
  isTrustedFrame: (tabId: number, frameId: number, documentId: string | undefined) => Promise<boolean>
  now?: () => number
}

export type FillRequestHandler = {
  /** Undefined when the message is not a fill request or does not come from a content script of the active tab. */
  handle: (message: unknown, sender: FillSender) => Promise<FillResponse> | undefined
  forgetTab: (tabId: number) => void
}

/** Whether a message comes from a content script of the tab the person is looking at: never another extension, an extension page, a hidden tab or a document that is not live. */
export function isActiveContentSender(sender: FillSender, extensionId: string, extensionUrl: string): boolean {
  return !(
    sender.id !== extensionId ||
    sender.tab?.id === undefined ||
    sender.tab.active !== true ||
    sender.frameId === undefined ||
    !sender.url ||
    sender.url.startsWith(extensionUrl) ||
    (sender.documentLifecycle && sender.documentLifecycle !== "active")
  )
}

export function isFillRequestMessage(message: unknown): boolean {
  return typeof message === "object" && message !== null && (message as { type?: unknown }).type === "fill-request"
}

/**
 * The only door to the api for a page: the sender must be a content script of the tab the person is looking at, in the
 * top frame or in a child frame the frame logic trusts. Its answer is a mapping, never the token or an api error text.
 */
export function createFillRequestHandler(deps: FillRequestDeps): FillRequestHandler {
  const limits = new Map<number, () => boolean>()
  /** One per tab: closing the tab stops the api work still running for it. */
  const stops = new Map<number, AbortController>()

  async function respond(message: unknown, tabId: number, sender: FillSender): Promise<FillResponse> {
    const allow = limits.get(tabId) ?? createRateLimiter(REQUEST_LIMIT.max, REQUEST_LIMIT.windowMs, deps.now)
    limits.set(tabId, allow)
    if (!allow()) return { ok: false, code: "busy" }
    const parsed = fillRequestMessageSchema.safeParse(message)
    if (!parsed.success || !sender.url || siteKey(sender.url) !== parsed.data.siteKey) {
      return { ok: false, code: "invalid" }
    }
    if (sender.frameId !== 0 && !(await deps.isTrustedFrame(tabId, sender.frameId as number, sender.documentId))) {
      return { ok: false, code: "invalid" }
    }
    const stop = stops.get(tabId) ?? new AbortController()
    stops.set(tabId, stop)
    return deps.service.run(parsed.data, stop.signal)
  }

  return {
    handle(message, sender) {
      if (!isFillRequestMessage(message)) return undefined
      if (!isActiveContentSender(sender, deps.extensionId, deps.extensionUrl)) return undefined
      return respond(message, sender.tab?.id as number, sender)
    },
    forgetTab: (tabId) => {
      limits.delete(tabId)
      stops.get(tabId)?.abort()
      stops.delete(tabId)
    },
  }
}
