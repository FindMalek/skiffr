import { ORPCError } from "@orpc/client"
import {
  AI_FIELDS_MAX,
  type FieldDescriptor,
  type FieldMapping,
  fieldDescriptorSchema,
  LEARNING_AUTOFILL_VALUE_MAX,
  LEARNING_FIELDS_MAX,
  LEARNING_REQUEST_CHARS_MAX,
  type LearningField,
  learningFieldSchema,
} from "@skiffr/common"
import { flattenProfile } from "@skiffr/common/utils"
import type { AppRouterClient } from "@skiffr/orpc/client"
import { NotConfiguredError } from "./api"
import { batchDescriptors } from "./fill/collect"
import {
  CALL_TIMEOUT_MS,
  FILL_CONFIDENCE_MIN,
  FILL_CONFIDENCE_REVIEW,
  type FillErrorCode,
  LEARNED_CONFIDENCE,
  PROFILE_READ_DEADLINE_MS,
  PROFILE_TTL_MS,
  REQUEST_DEADLINE_MS,
  RETRY_BACKOFF_MS,
} from "./fill-config"
import type { FillField, FillRequestMessage, FillResponse, FillSummaryData } from "./messages"

export type ApiCall = <T>(run: (client: AppRouterClient) => Promise<T>) => Promise<T>

export type FillServiceDeps = {
  call: ApiCall
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export type FillService = {
  /** `signal` stops the remaining work, for a tab that went away. */
  run: (request: FillRequestMessage, signal?: AbortSignal) => Promise<FillResponse>
  /** Forgets the cached profile, for when the token or api url changed. */
  clear: () => void
}

class FillError extends Error {
  constructor(readonly code: FillErrorCode) {
    super(code)
  }
}

const FATAL: ReadonlySet<FillErrorCode> = new Set(["not-configured", "rejected"])
/** Reads are safe to repeat after any transient failure. */
const RETRY_READS: ReadonlySet<FillErrorCode> = new Set(["unavailable", "unreachable", "timeout"])
/** `ai.mapFields` is paid: it is repeated only when the request never reached the server, never after a timeout or a 5xx. */
const RETRY_PAID: ReadonlySet<FillErrorCode> = new Set(["unreachable"])
/** The host is not there: a second call to it would fail the same way. */
const DEAD_HOST: ReadonlySet<FillErrorCode> = new Set(["unreachable", "timeout"])
const NEVER_SENT = new Set(["password", "hidden", "file"])
const SENSITIVE_AUTOCOMPLETE = /(^|\s)(current-password|new-password|one-time-code|cc-[a-z-]+)(\s|$)/i

/** Never an error text or a label: only the class of failure leaves this function. */
export function classify(error: unknown): FillErrorCode {
  if (error instanceof FillError) return error.code
  if (error instanceof NotConfiguredError) return "not-configured"
  if (error instanceof ORPCError) {
    if (error.status === 401 || error.status === 403) return "rejected"
    if (error.status === 412) return "no-profile"
    if (error.status === 429) return "busy"
    if (error.status === 400) return "invalid"
    if (error.status >= 500) return "unavailable"
    return "failed"
  }
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return "timeout"
  if (error instanceof TypeError) return "unreachable"
  return "failed"
}

function neverSent(field: FillField): boolean {
  const type = (field.type ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}]/gu, "")
    .toLowerCase()
  return NEVER_SENT.has(type) || SENSITIVE_AUTOCOMPLETE.test(field.autocomplete ?? "")
}

function chunk<T>(items: T[], max: number, chars: number, size: (item: T) => number): T[][] {
  const chunks: T[][] = []
  let current: T[] = []
  let used = 0
  for (const item of items) {
    const own = size(item)
    if (current.length > 0 && (current.length >= max || used + own > chars)) {
      chunks.push(current)
      current = []
      used = 0
    }
    current.push(item)
    used += own
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

const learningSize = (f: LearningField) =>
  [f.id, f.label, f.type, f.autocomplete, ...f.options].reduce<number>((sum, text) => sum + (text?.length ?? 0), 0)

type Learned = { value: string; source: "site" | "exact" | "label" }

/**
 * The worker side of a fill. Order of authority for one field: site > exact > label > the model's mapping. The server
 * already picks the best saved answer per field (what happened last time on this form, then an exact question match,
 * then the same label), and a saved answer is never overridden by the model. A candidate with `autofill: false`
 * (a similar-question answer, a long value, an answer cleared too often) never fills anything: it only ends up as a
 * suggestion when the model could not fill the field either.
 */
export function createFillService({
  call,
  now = Date.now,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}: FillServiceDeps): FillService {
  let cache: { at: number; values: Record<string, string> } | null = null
  let inflight: Promise<Record<string, string> | null> | null = null
  /** Bumped when the settings change: whatever an older generation is still fetching belongs to the old token. */
  let generation = 0

  type Run = { deadline: number; signal?: AbortSignal; generation: number }

  function assertCurrent(ctx: Run): void {
    if (ctx.signal?.aborted) throw new FillError("failed")
    if (ctx.generation !== generation) throw new FillError("changed")
  }

  async function api<T>(
    ctx: Run,
    retry: ReadonlySet<FillErrorCode>,
    timeoutMs: number,
    run: (client: AppRouterClient, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      assertCurrent(ctx)
      const left = ctx.deadline - now()
      if (left <= 0) throw new FillError("timeout")
      const timer = AbortSignal.timeout(Math.min(timeoutMs, left))
      const signal = ctx.signal ? AbortSignal.any([timer, ctx.signal]) : timer
      try {
        return await call((client) => run(client, signal))
      } catch (error) {
        assertCurrent(ctx)
        const code = classify(error)
        if (attempt >= 1 || !retry.has(code)) throw new FillError(code)
        await sleep(RETRY_BACKOFF_MS)
      }
    }
  }

  /**
   * Flattened profile, kept in memory for a minute so several frames and a quick retry share one read. The read is
   * shared, so it has a signal and a deadline of its own: no one waiter (a tab that closes) can cancel it for the others.
   */
  function sharedProfile(): Promise<Record<string, string> | null> {
    if (cache && now() - cache.at < PROFILE_TTL_MS) return Promise.resolve(cache.values)
    if (inflight) return inflight
    const mine = generation
    const own: Run = { deadline: now() + PROFILE_READ_DEADLINE_MS, generation: mine }
    inflight = api(own, RETRY_READS, CALL_TIMEOUT_MS.profile, (client, signal) =>
      client.profile.get(undefined, { signal }),
    )
      .then((profile) => {
        // a read that started before a settings change is the old account's profile: neither kept nor used
        if (mine !== generation) throw new FillError("changed")
        if (!profile) return null
        const values = flattenProfile(profile)
        cache = { at: now(), values }
        return values
      })
      .finally(() => {
        if (mine === generation) inflight = null
      })
    return inflight
  }

  /** One waiter on the shared read: it gives up on its own tab's signal and deadline without touching the read. */
  function waitForProfile(ctx: Run): Promise<Record<string, string> | null> {
    let stop: () => void = () => {}
    const bail = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new FillError("timeout")), Math.max(0, ctx.deadline - now()))
      const onAbort = () => reject(new FillError("failed"))
      ctx.signal?.addEventListener("abort", onAbort, { once: true })
      stop = () => {
        clearTimeout(timer)
        ctx.signal?.removeEventListener("abort", onAbort)
      }
    })
    return Promise.race([sharedProfile(), bail]).finally(stop)
  }

  async function lookup(ctx: Run, fields: FillField[], siteKey: string): Promise<Map<string, Learned | "suggest">> {
    const usable: LearningField[] = []
    for (const field of fields) {
      if (!field.label?.trim()) continue
      const parsed = learningFieldSchema.safeParse({
        id: field.id,
        label: field.label,
        type: field.type,
        autocomplete: field.autocomplete,
        options: field.options,
      })
      if (parsed.success) usable.push(parsed.data)
    }
    const known = new Set(usable.map((field) => field.id))
    const found = new Map<string, Learned | "suggest">()
    for (const batch of chunk(usable, LEARNING_FIELDS_MAX, LEARNING_REQUEST_CHARS_MAX, learningSize)) {
      const { matches } = await api(ctx, RETRY_READS, CALL_TIMEOUT_MS.lookup, (client, signal) =>
        client.learning.lookup({ siteKey, fields: batch }, { signal }),
      )
      for (const match of matches) {
        if (match.source === "none" || !known.has(match.fieldId)) continue
        const { source, value } = match
        const fillable = match.autofill && value.trim() !== "" && value.length <= LEARNING_AUTOFILL_VALUE_MAX
        found.set(match.fieldId, fillable && source !== "similar" ? { value, source } : "suggest")
      }
    }
    return found
  }

  /** Batches run one after the other; one that fails ends the loop and keeps what the earlier ones gave. */
  async function mapAll(
    ctx: Run,
    fields: FillField[],
    onBatch: (batch: FieldMapping[]) => void,
  ): Promise<{ mappings: FieldMapping[]; problem?: unknown }> {
    const descriptors: FieldDescriptor[] = []
    for (const field of fields) {
      const parsed = fieldDescriptorSchema.safeParse(field)
      if (parsed.success) descriptors.push(parsed.data)
    }
    const known = new Set(descriptors.map((d) => d.id))
    const mappings: FieldMapping[] = []
    for (const batch of batchDescriptors(descriptors)) {
      try {
        const out = await api(ctx, RETRY_PAID, CALL_TIMEOUT_MS.mapFields, (client, signal) =>
          client.ai.mapFields({ fields: batch.slice(0, AI_FIELDS_MAX) }, { signal }),
        )
        const kept = out.mappings.filter((mapping) => known.has(mapping.id))
        mappings.push(...kept)
        onBatch(kept)
      } catch (error) {
        const code = classify(error)
        if (mappings.length === 0 || FATAL.has(code) || code === "changed") throw error
        return { mappings, problem: error }
      }
    }
    return { mappings }
  }

  async function run(request: FillRequestMessage, signal?: AbortSignal): Promise<FillResponse> {
    const ctx: Run = { deadline: now() + REQUEST_DEADLINE_MS, signal, generation }
    const fields = request.fields.filter((field) => !neverSent(field))
    const problems: FillErrorCode[] = []
    let lookedUp = false
    const failed = (error: unknown): void => {
      const code = classify(error)
      // a changed setting, a gone tab, or a token that was never accepted: nothing partial is worth showing
      if (code === "changed" || ctx.signal?.aborted || (FATAL.has(code) && !lookedUp)) throw new FillError(code)
      problems.push(code)
    }

    let learned = new Map<string, Learned | "suggest">()
    try {
      learned = await lookup(ctx, fields, request.siteKey)
      lookedUp = true
    } catch (error) {
      // the host did not answer: the model call would fail the same way, so fail now with the clear message
      const code = classify(error)
      if (DEAD_HOST.has(code)) throw new FillError(code)
      failed(error)
    }

    // read as soon as a model answer wants the profile, while the other batches are still running
    let profileRead: Promise<{ values: Record<string, string> | null } | { error: unknown }> | null = null
    const startProfile = (batch: FieldMapping[]): void => {
      if (profileRead || !batch.some((m) => m.action === "profile" && m.confidence >= FILL_CONFIDENCE_MIN)) return
      profileRead = waitForProfile(ctx).then(
        (values) => ({ values }),
        (error: unknown) => ({ error }),
      )
    }

    const needsModel = fields.filter((field) => typeof learned.get(field.id) !== "object")
    let mappings: FieldMapping[] = []
    if (needsModel.length > 0) {
      try {
        const done = await mapAll(ctx, needsModel, startProfile)
        mappings = done.mappings
        if (done.problem) failed(done.problem)
      } catch (error) {
        failed(error)
      }
    }

    let profile: Record<string, string> | null = null
    if (profileRead) {
      const read = await (profileRead as Promise<{ values: Record<string, string> | null } | { error: unknown }>)
      if ("error" in read) failed(read.error)
      else {
        profile = read.values
        if (!profile) problems.push("no-profile")
      }
    }

    const summary: FillSummaryData = {
      site: 0,
      exact: 0,
      label: 0,
      profile: 0,
      generated: 0,
      review: 0,
      suggested: 0,
      skipped: 0,
    }
    const mapping: FieldMapping[] = []
    const values: Record<string, string> = {}
    const aiById = new Map(mappings.map((m) => [m.id, m]))
    const suggestions: string[] = []

    for (const field of fields) {
      const hit = learned.get(field.id)
      if (typeof hit === "object") {
        const confidence = LEARNED_CONFIDENCE[hit.source]
        mapping.push({
          id: field.id,
          action: "generate",
          value: hit.value,
          confidence,
          reason: `saved answer (${hit.source})`,
        })
        summary[hit.source]++
        continue
      }
      const ai = aiById.get(field.id)
      let filled = false
      if (ai && ai.action !== "skip" && ai.confidence >= FILL_CONFIDENCE_MIN) {
        if (ai.action === "generate" && ai.value.trim()) {
          // an invented or picked value (yes/no, eligibility, a free answer) is always for the person to check
          mapping.push({ ...ai, confidence: Math.min(ai.confidence, FILL_CONFIDENCE_REVIEW - 0.01) })
          summary.generated++
          summary.review++
          filled = true
        } else if (ai.action === "profile" && profile && Object.hasOwn(profile, ai.key) && profile[ai.key]) {
          mapping.push(ai)
          values[ai.key] = profile[ai.key] as string
          summary.profile++
          filled = true
        }
        if (filled && ai.action === "profile" && ai.confidence < FILL_CONFIDENCE_REVIEW) summary.review++
      }
      if (filled) continue
      if (hit === "suggest") {
        suggestions.push(field.id)
        summary.suggested++
      } else if (ai) {
        summary.skipped++
      }
    }

    assertCurrent(ctx)
    const [problem] = problems
    if (problem && mapping.length === 0 && suggestions.length === 0) throw new FillError(problem)
    return { ok: true, mapping, values, suggestions, summary: { ...summary, ...(problem ? { problem } : {}) } }
  }

  return {
    run: async (request, signal) => {
      try {
        return await run(request, signal)
      } catch (error) {
        return { ok: false, code: classify(error) }
      }
    },
    clear: () => {
      generation++
      cache = null
      inflight = null
    },
  }
}
