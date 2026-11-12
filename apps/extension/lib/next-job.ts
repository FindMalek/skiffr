import { ORPCError } from "@orpc/client"
import { atsFromCanonicalId, canonicalizeJob, displayText, safeHref } from "@skiffr/common"
import { z } from "zod"
import { siteKey } from "./detect/ats"
import { createRateLimiter } from "./detect/rate-limit"
import { NEXT_JOBS_MAX, NEXT_LIMIT, NEXT_OFFER_TTL_MS, NEXT_TIMEOUT_MS } from "./fill-config"
import { type FillRequestDeps, type FillSender, isActiveContentSender } from "./fill-request"
import { type ApiCall, classify } from "./fill-service"
import {
  applicationSubmittedMessageSchema,
  type JobBrief,
  type NextJobResponse,
  type NextOfferMessage,
  nextDecisionMessageSchema,
} from "./messages"

const BRIEF_MAX = 60

/** The few fields read off a job. The api is trusted to be ours, not to send only what the toast may show. */
const queuedJobSchema = z.object({
  id: z.uuid(),
  url: z.string(),
  canonicalId: z.string(),
  title: z.string(),
  company: z.string(),
})
type QueuedJob = z.infer<typeof queuedJobSchema>

export type NextJobDeps = Pick<FillRequestDeps, "extensionId" | "extensionUrl" | "isTrustedFrame" | "now"> & {
  call: ApiCall
  /** The url the top frame of the tab reported, for a submit that happened in a child frame. */
  topUrl: (tabId: number) => Promise<string | null>
  isMuted: (siteKey: string) => Promise<boolean>
  mute: (siteKey: string) => Promise<void>
  open: (url: string) => Promise<void>
  /** Shows an offer in the top frame of the tab. */
  offer: (tabId: number, message: NextOfferMessage) => void
  newId?: () => string
}

export type NextJobHandler = {
  /** Undefined when the message is not for this handler or does not come from a content script of the active tab. */
  handle: (message: unknown, sender: FillSender) => Promise<NextJobResponse> | undefined
  forgetTab: (tabId: number) => void
}

type Offer = {
  id: string
  at: number
  site: string
  matched: QueuedJob | null
  next: QueuedJob | null
  /** Checked when the offer was made: the only address this offer can open. */
  href: string | null
  replayed: boolean
}

const brief = (job: QueuedJob | null): JobBrief | null =>
  job ? { title: displayText(job.title, BRIEF_MAX), company: displayText(job.company, BRIEF_MAX) } : null

function isType(message: unknown, ...types: string[]): boolean {
  const type = typeof message === "object" && message !== null ? (message as { type?: unknown }).type : undefined
  return typeof type === "string" && types.includes(type)
}

/**
 * After a submit in a tab skiffr filled, offers the next queued job, and the chance to mark the one just submitted
 * as applied. Nothing happens without the person: a job opens in a new tab and is marked applied only when they
 * choose it in the toast. The page never sees a url or a job id, only text to show, and every decision is checked
 * against the offer the worker made for that tab. The answer is ok or a failure class, never an error text.
 */
export function createNextJobHandler(deps: NextJobDeps): NextJobHandler {
  const now = deps.now ?? Date.now
  const newId = deps.newId ?? (() => crypto.randomUUID())
  const limits = new Map<number, () => boolean>()
  const busy = new Set<number>()
  /** Pages already asked about, per tab: a submit that fails and is sent again does not ask twice. */
  const asked = new Map<number, Set<string>>()
  const offers = new Map<number, Offer>()

  const allowed = (tabId: number): boolean => {
    const allow = limits.get(tabId) ?? createRateLimiter(NEXT_LIMIT.max, NEXT_LIMIT.windowMs, deps.now)
    limits.set(tabId, allow)
    return allow()
  }

  function show(tabId: number, offer: Offer): void {
    deps.offer(tabId, {
      type: "next-offer",
      offerId: offer.id,
      matched: brief(offer.matched),
      next: brief(offer.next),
    })
  }

  async function pageUrlOf(tabId: number, sender: FillSender): Promise<string | null> {
    return sender.frameId === 0 ? (sender.url ?? null) : deps.topUrl(tabId)
  }

  async function submitted(message: unknown, tabId: number, sender: FillSender): Promise<NextJobResponse> {
    const parsed = applicationSubmittedMessageSchema.safeParse(message)
    if (!parsed.success || !sender.url || siteKey(sender.url) !== parsed.data.siteKey) {
      return { ok: false, code: "invalid" }
    }
    if (sender.frameId !== 0 && !(await deps.isTrustedFrame(tabId, sender.frameId as number, sender.documentId))) {
      return { ok: false, code: "invalid" }
    }
    const pageUrl = await pageUrlOf(tabId, sender)
    const site = pageUrl ? siteKey(pageUrl) : null
    if (!pageUrl || !site) return { ok: false, code: "invalid" }
    const pageId = canonicalizeJob(pageUrl).canonicalId
    const seen = asked.get(tabId) ?? new Set<string>()
    asked.set(tabId, seen)
    if (seen.has(pageId) || busy.has(tabId)) return { ok: true }
    busy.add(tabId)
    seen.add(pageId)
    try {
      if (await deps.isMuted(site)) return { ok: true }
      const signal = AbortSignal.timeout(NEXT_TIMEOUT_MS)
      const rows = await deps.call((client) =>
        client.jobs.list({ status: "queued", order: "oldest", limit: NEXT_JOBS_MAX, offset: 0 }, { signal }),
      )
      const jobs = z.array(queuedJobSchema).parse(rows)
      const matched = jobs.find((job) => job.canonicalId === pageId) ?? null
      const next = jobs.find((job) => job.id !== matched?.id && safeHref(job.url) !== null) ?? null
      if (!matched && !next) return { ok: true }
      const offer: Offer = {
        id: newId(),
        at: now(),
        site,
        matched,
        next,
        href: next ? safeHref(next.url) : null,
        replayed: false,
      }
      offers.set(tabId, offer)
      show(tabId, offer)
      return { ok: true }
    } catch (error) {
      seen.delete(pageId)
      return { ok: false, code: classify(error) }
    } finally {
      busy.delete(tabId)
    }
  }

  async function markApplied(job: QueuedJob): Promise<void> {
    const signal = AbortSignal.timeout(NEXT_TIMEOUT_MS)
    try {
      await deps.call((client) =>
        client.applications.create({ jobId: job.id, ats: atsFromCanonicalId(job.canonicalId) }, { signal }),
      )
    } catch (error) {
      // the job already has its application: it is marked, which is what was asked
      if (!(error instanceof ORPCError && error.status === 409)) throw error
    }
  }

  async function decided(message: unknown, tabId: number, sender: FillSender): Promise<NextJobResponse> {
    const parsed = nextDecisionMessageSchema.safeParse(message)
    const offer = offers.get(tabId)
    if (!parsed.success || sender.frameId !== 0 || !offer || offer.id !== parsed.data.offerId) {
      return { ok: false, code: "invalid" }
    }
    const { action } = parsed.data
    if (action === "dismiss") {
      offers.delete(tabId)
      return { ok: true }
    }
    if (action === "never") {
      offers.delete(tabId)
      await deps.mute(offer.site).catch(() => {})
      return { ok: true }
    }
    if (busy.has(tabId)) return { ok: false, code: "busy" }
    busy.add(tabId)
    try {
      if (action === "open") {
        if (!offer.href) return { ok: false, code: "invalid" }
        await deps.open(offer.href)
        offer.next = null
        offer.href = null
      } else {
        if (!offer.matched) return { ok: false, code: "invalid" }
        await markApplied(offer.matched)
        offer.matched = null
      }
      if (!offer.matched && !offer.next) offers.delete(tabId)
      return { ok: true }
    } catch (error) {
      return { ok: false, code: classify(error) }
    } finally {
      busy.delete(tabId)
    }
  }

  function replay(tabId: number): void {
    const offer = offers.get(tabId)
    if (!offer || offer.replayed) return
    if (now() - offer.at > NEXT_OFFER_TTL_MS) return void offers.delete(tabId)
    offer.replayed = true
    show(tabId, offer)
  }

  return {
    handle(message, sender) {
      if (!isType(message, "application-submitted", "next-decision", "probe-frames")) return undefined
      if (!isActiveContentSender(sender, deps.extensionId, deps.extensionUrl)) return undefined
      const tabId = sender.tab?.id as number
      if (isType(message, "probe-frames")) {
        // the top document of the tab is a new one: the page the submit led to gets the offer the old one lost
        if (sender.frameId === 0) replay(tabId)
        return undefined
      }
      if (!allowed(tabId)) return Promise.resolve({ ok: false, code: "busy" })
      return isType(message, "application-submitted")
        ? submitted(message, tabId, sender)
        : decided(message, tabId, sender)
    },
    forgetTab: (tabId) => {
      limits.delete(tabId)
      busy.delete(tabId)
      asked.delete(tabId)
      offers.delete(tabId)
    },
  }
}
