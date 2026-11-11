import { recordInputSchema } from "@skiffr/common"
import { siteKey } from "./detect/ats"
import { createRateLimiter } from "./detect/rate-limit"
import { RECORD_LIMIT, RECORD_TIMEOUT_MS } from "./fill-config"
import { type FillRequestDeps, type FillSender, isActiveContentSender } from "./fill-request"
import { type ApiCall, classify } from "./fill-service"
import { recordable } from "./learning-events"
import { type LearningRecordResponse, learningRecordMessageSchema } from "./messages"

export type LearningRecordDeps = Pick<FillRequestDeps, "extensionId" | "extensionUrl" | "isTrustedFrame" | "now"> & {
  call: ApiCall
}

export type LearningRecordHandler = {
  /** Undefined when the message is not a learning record or does not come from a content script of the active tab. */
  handle: (message: unknown, sender: FillSender) => Promise<LearningRecordResponse> | undefined
  forgetTab: (tabId: number) => void
}

export function isLearningRecordMessage(message: unknown): boolean {
  return typeof message === "object" && message !== null && (message as { type?: unknown }).type === "learning-record"
}

/**
 * Same door as a fill request: a content script of the active tab, in the top frame or a trusted child frame, for its
 * own site. One batch per tab at a time, and a cap per minute. The answer is ok or a failure class, never an error text.
 */
export function createLearningRecordHandler(deps: LearningRecordDeps): LearningRecordHandler {
  const limits = new Map<number, () => boolean>()
  const busy = new Set<number>()
  const stops = new Map<number, AbortController>()

  async function respond(message: unknown, tabId: number, sender: FillSender): Promise<LearningRecordResponse> {
    const allow = limits.get(tabId) ?? createRateLimiter(RECORD_LIMIT.max, RECORD_LIMIT.windowMs, deps.now)
    limits.set(tabId, allow)
    if (!allow() || busy.has(tabId)) return { ok: false, code: "busy" }
    busy.add(tabId)
    try {
      const parsed = learningRecordMessageSchema.safeParse(message)
      if (!parsed.success || !sender.url || siteKey(sender.url) !== parsed.data.siteKey) {
        return { ok: false, code: "invalid" }
      }
      if (sender.frameId !== 0 && !(await deps.isTrustedFrame(tabId, sender.frameId as number, sender.documentId))) {
        return { ok: false, code: "invalid" }
      }
      const { siteKey: site, batchId, events } = parsed.data
      const kept = recordable(events)
      if (kept.length === 0) return { ok: true }
      const input = recordInputSchema.safeParse({ siteKey: site, batchId, events: kept })
      if (!input.success) return { ok: false, code: "invalid" }
      const stop = stops.get(tabId) ?? new AbortController()
      stops.set(tabId, stop)
      const signal = AbortSignal.any([AbortSignal.timeout(RECORD_TIMEOUT_MS), stop.signal])
      await deps.call((client) => client.learning.record(input.data, { signal }))
      return { ok: true }
    } catch (error) {
      return { ok: false, code: classify(error) }
    } finally {
      busy.delete(tabId)
    }
  }

  return {
    handle(message, sender) {
      if (!isLearningRecordMessage(message)) return undefined
      if (!isActiveContentSender(sender, deps.extensionId, deps.extensionUrl)) return undefined
      return respond(message, sender.tab?.id as number, sender)
    },
    forgetTab: (tabId) => {
      limits.delete(tabId)
      busy.delete(tabId)
      stops.get(tabId)?.abort()
      stops.delete(tabId)
    },
  }
}
