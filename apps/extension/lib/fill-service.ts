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
  PROFILE_TTL_MS,
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
  run: (request: FillRequestMessage) => Promise<FillResponse>
  /** Forgets the cached profile, for when the token or api url changed. */
  clear: () => void
}

class FillError extends Error {
  constructor(readonly code: FillErrorCode) {
    super(code)
  }
}

const FATAL: ReadonlySet<FillErrorCode> = new Set(["not-configured", "rejected"])
const RETRYABLE: ReadonlySet<FillErrorCode> = new Set(["unavailable", "unreachable", "timeout"])
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

  async function api<T>(
    timeoutMs: number,
    run: (client: AppRouterClient, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await call((client) => run(client, AbortSignal.timeout(timeoutMs)))
      } catch (error) {
        const code = classify(error)
        if (attempt >= 1 || !RETRYABLE.has(code)) throw new FillError(code)
        await sleep(RETRY_BACKOFF_MS)
      }
    }
  }

  /** Flattened profile, kept in memory for a minute so several frames and a quick retry share one read. */
  function profileValues(): Promise<Record<string, string> | null> {
    if (cache && now() - cache.at < PROFILE_TTL_MS) return Promise.resolve(cache.values)
    inflight ??= api(CALL_TIMEOUT_MS.profile, (client, signal) => client.profile.get(undefined, { signal }))
      .then((profile) => {
        if (!profile) return null
        const values = flattenProfile(profile)
        cache = { at: now(), values }
        return values
      })
      .finally(() => {
        inflight = null
      })
    return inflight
  }

  async function lookup(fields: FillField[], siteKey: string): Promise<Map<string, Learned | "suggest">> {
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
      const { matches } = await api(CALL_TIMEOUT_MS.lookup, (client, signal) =>
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

  async function mapAll(fields: FillField[]): Promise<FieldMapping[]> {
    const descriptors: FieldDescriptor[] = []
    for (const field of fields) {
      const parsed = fieldDescriptorSchema.safeParse(field)
      if (parsed.success) descriptors.push(parsed.data)
    }
    const known = new Set(descriptors.map((d) => d.id))
    const mappings: FieldMapping[] = []
    for (const batch of batchDescriptors(descriptors)) {
      const out = await api(CALL_TIMEOUT_MS.mapFields, (client, signal) =>
        client.ai.mapFields({ fields: batch.slice(0, AI_FIELDS_MAX) }, { signal }),
      )
      mappings.push(...out.mappings.filter((mapping) => known.has(mapping.id)))
    }
    return mappings
  }

  async function run(request: FillRequestMessage): Promise<FillResponse> {
    const fields = request.fields.filter((field) => !neverSent(field))
    const problems: FillErrorCode[] = []
    const failed = (error: unknown): void => {
      const code = classify(error)
      if (FATAL.has(code)) throw new FillError(code)
      problems.push(code)
    }

    let learned = new Map<string, Learned | "suggest">()
    try {
      learned = await lookup(fields, request.siteKey)
    } catch (error) {
      failed(error)
    }

    const needsModel = fields.filter((field) => typeof learned.get(field.id) !== "object")
    let mappings: FieldMapping[] = []
    if (needsModel.length > 0) {
      try {
        mappings = await mapAll(needsModel)
      } catch (error) {
        failed(error)
      }
    }

    let profile: Record<string, string> | null = null
    if (mappings.some((m) => m.action === "profile" && m.confidence >= FILL_CONFIDENCE_MIN)) {
      try {
        profile = await profileValues()
        if (!profile) problems.push("no-profile")
      } catch (error) {
        failed(error)
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
          mapping.push(ai)
          summary.generated++
          filled = true
        } else if (ai.action === "profile" && profile?.[ai.key]) {
          mapping.push(ai)
          values[ai.key] = profile[ai.key] as string
          summary.profile++
          filled = true
        }
        if (filled && ai.confidence < FILL_CONFIDENCE_REVIEW) summary.review++
      }
      if (filled) continue
      if (hit === "suggest") {
        suggestions.push(field.id)
        summary.suggested++
      } else if (ai) {
        summary.skipped++
      }
    }

    const filledCount = summary.exact + summary.label + summary.profile + summary.generated
    const [problem] = problems
    if (problem && filledCount === 0 && suggestions.length === 0) throw new FillError(problem)
    return { ok: true, mapping, values, suggestions, summary: { ...summary, ...(problem ? { problem } : {}) } }
  }

  return {
    run: async (request) => {
      try {
        return await run(request)
      } catch (error) {
        return { ok: false, code: classify(error) }
      }
    },
    clear: () => {
      cache = null
    },
  }
}
