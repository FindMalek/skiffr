import { ORPCError } from "@orpc/client"
import { atsFromCanonicalId, canonicalizeJob, displayText, safeHref } from "@skiffr/common"
import { z } from "zod"
import { siteKey } from "./detect/ats"
import type { FrameStorage } from "./detect/frames"
import { createRateLimiter } from "./detect/rate-limit"
import { NEXT_JOBS_MAX, NEXT_LIMIT, NEXT_OFFER_MAX_MS, NEXT_REPLAY_MS, NEXT_TIMEOUT_MS } from "./fill-config"
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
const STORAGE_KEY = "nextJobOffers"
const ASKED_PER_TAB_MAX = 20

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
  /** Session storage of the worker: offers must outlive a worker that was stopped while the toast was open. */
  storage: FrameStorage
  isMuted: (siteKey: string) => Promise<boolean>
  mute: (siteKey: string) => Promise<void>
  open: (url: string, windowId: number | undefined) => Promise<void>
  /** Shows an offer in the top frame of the tab. */
  offer: (tabId: number, message: NextOfferMessage) => void
  newId?: () => string
}

export type NextJobHandler = {
  /** Undefined when the message is not for this handler or does not come from a content script of the active tab. */
  handle: (message: unknown, sender: FillSender) => Promise<NextJobResponse> | undefined
  forgetTab: (tabId: number) => Promise<void>
}

const offerSchema = z.object({
  id: z.uuid(),
  tabId: z.number().int(),
  at: z.number(),
  expiresAt: z.number(),
  /** The site the submit happened on: the only site this offer may be shown or answered on. */
  site: z.string(),
  matched: queuedJobSchema.nullable(),
  next: queuedJobSchema.nullable(),
  /** Checked when the offer was made: the only address this offer can open. */
  href: z.string().nullable(),
  replayed: z.boolean(),
})
type Offer = z.infer<typeof offerSchema>

const storedSchema = z.object({
  offers: z.array(offerSchema),
  asked: z.record(z.string(), z.array(z.string())),
})

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
 * against the offer the worker made for that tab, on the site it was made for. Offers are kept in session storage
 * (closed to content scripts like the token), so a worker that was stopped meanwhile still answers. The answer is ok
 * or a failure class, never an error text.
 */
export function createNextJobHandler(deps: NextJobDeps): NextJobHandler {
  const now = deps.now ?? Date.now
  const newId = deps.newId ?? (() => crypto.randomUUID())
  const limits = new Map<number, () => boolean>()
  const busy = new Set<number>()
  /** Pages already asked about, per tab: a submit that fails and is sent again does not ask twice. */
  const asked = new Map<number, string[]>()
  const offers = new Map<number, Offer>()
  let ready: Promise<void> | null = null

  function load(): Promise<void> {
    ready ??= deps.storage
      .get(STORAGE_KEY)
      .then((stored) => {
        const parsed = storedSchema.safeParse(stored[STORAGE_KEY])
        if (!parsed.success) return
        for (const offer of parsed.data.offers) if (offer.expiresAt > now()) offers.set(offer.tabId, offer)
        for (const [tab, pages] of Object.entries(parsed.data.asked)) asked.set(Number(tab), pages)
      })
      .catch(() => {})
    return ready
  }

  async function save(): Promise<void> {
    const state = {
      offers: [...offers.values()],
      asked: Object.fromEntries([...asked].map(([tab, pages]) => [String(tab), pages])),
    }
    await deps.storage.set({ [STORAGE_KEY]: state }).catch(() => {})
  }

  const allowed = (tabId: number): boolean => {
    const allow = limits.get(tabId) ?? createRateLimiter(NEXT_LIMIT.max, NEXT_LIMIT.windowMs, deps.now)
    limits.set(tabId, allow)
    return allow()
  }

  function show(offer: Offer): void {
    deps.offer(offer.tabId, {
      type: "next-offer",
      offerId: offer.id,
      siteKey: offer.site,
      matched: brief(offer.matched),
      next: brief(offer.next),
    })
  }

  async function drop(tabId: number): Promise<void> {
    offers.delete(tabId)
    await save()
  }

  async function pageUrlOf(tabId: number, sender: FillSender): Promise<string | null> {
    return sender.frameId === 0 ? (sender.url ?? null) : deps.topUrl(tabId)
  }

  function markAsked(tabId: number, pageId: string): void {
    const pages = (asked.get(tabId) ?? []).filter((id) => id !== pageId)
    asked.set(tabId, [...pages, pageId].slice(-ASKED_PER_TAB_MAX))
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
    await load()
    const pageId = canonicalizeJob(pageUrl).canonicalId
    if (asked.get(tabId)?.includes(pageId) || busy.has(tabId)) return { ok: true }
    busy.add(tabId)
    markAsked(tabId, pageId)
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
      // the list can take a while: an offer for the page the person left is not made
      const current = await deps.topUrl(tabId)
      if (current && siteKey(current) !== site) return { ok: true }
      const offer: Offer = {
        id: newId(),
        tabId,
        at: now(),
        expiresAt: now() + NEXT_OFFER_MAX_MS,
        site,
        matched,
        next,
        href: next ? safeHref(next.url) : null,
        replayed: false,
      }
      offers.set(tabId, offer)
      await save()
      show(offer)
      return { ok: true }
    } catch (error) {
      asked.set(
        tabId,
        (asked.get(tabId) ?? []).filter((id) => id !== pageId),
      )
      return { ok: false, code: classify(error) }
    } finally {
      busy.delete(tabId)
      await save()
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
    await load()
    const offer = offers.get(tabId)
    if (!parsed.success || sender.frameId !== 0 || !offer || offer.id !== parsed.data.offerId) {
      return { ok: false, code: "invalid" }
    }
    if (now() > offer.expiresAt || siteKey(sender.url as string) !== offer.site) {
      await drop(tabId)
      return { ok: false, code: "invalid" }
    }
    const { action } = parsed.data
    if (action === "dismiss") {
      await drop(tabId)
      return { ok: true }
    }
    if (action === "never") {
      await drop(tabId)
      await deps.mute(offer.site).catch(() => {})
      return { ok: true }
    }
    if (busy.has(tabId)) return { ok: false, code: "busy" }
    busy.add(tabId)
    try {
      if (action === "open") {
        if (!offer.href) return { ok: false, code: "invalid" }
        await deps.open(offer.href, sender.tab?.windowId)
        offer.next = null
        offer.href = null
      } else {
        if (!offer.matched) return { ok: false, code: "invalid" }
        await markApplied(offer.matched)
        offer.matched = null
      }
      if (!offer.matched && !offer.next) offers.delete(tabId)
      await save()
      return { ok: true }
    } catch (error) {
      return { ok: false, code: classify(error) }
    } finally {
      busy.delete(tabId)
    }
  }

  /** A new top document in the tab: if it is the same site, it gets the offer the old document lost. On another site the offer is over. */
  async function replay(tabId: number, url: string): Promise<void> {
    await load()
    const offer = offers.get(tabId)
    if (!offer || offer.replayed) return
    if (siteKey(url) !== offer.site || now() > offer.expiresAt) return drop(tabId)
    if (now() - offer.at > NEXT_REPLAY_MS) return
    offer.replayed = true
    await save()
    show(offer)
  }

  return {
    handle(message, sender) {
      if (!isType(message, "application-submitted", "next-decision", "probe-frames")) return undefined
      if (!isActiveContentSender(sender, deps.extensionId, deps.extensionUrl)) return undefined
      const tabId = sender.tab?.id as number
      if (isType(message, "probe-frames")) {
        if (sender.frameId === 0) void replay(tabId, sender.url as string)
        return undefined
      }
      if (!allowed(tabId)) return Promise.resolve({ ok: false, code: "busy" })
      return isType(message, "application-submitted")
        ? submitted(message, tabId, sender)
        : decided(message, tabId, sender)
    },
    async forgetTab(tabId) {
      limits.delete(tabId)
      busy.delete(tabId)
      await load()
      asked.delete(tabId)
      offers.delete(tabId)
      await save()
    },
  }
}
