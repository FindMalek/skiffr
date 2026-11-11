import { siteKey } from "./detect/ats"
import { type CollectedField, type FieldMapping, type FillSummary, watchEdits } from "./fill"
import { type FillErrorCode, LEARNING_IDLE_MS, LEARNING_RETRY_DELAYS_MS } from "./fill-config"
import { buildEvents } from "./learning-events"
import { type LearningRecordMessage, learningRecordResponseSchema } from "./messages"

export type LearningStart = {
  root: ParentNode
  fields: CollectedField[]
  mapping: FieldMapping[]
  summary: FillSummary
}

export type LearningSessionDeps = {
  send: (message: LearningRecordMessage) => Promise<unknown>
  doc?: Document
  win?: Window
  url?: () => string
  newBatchId?: () => string
  idleMs?: number
  retryDelaysMs?: readonly number[]
}

export type LearningSession = {
  /** Starts watching the fields of a fill. A session still open is sent first. */
  begin: (start: LearningStart) => void
  /** Sends the open session now. Calling it again changes nothing: a batch is sent once. */
  flush: () => Promise<void>
  /** Drops the open session without sending it. */
  stop: () => void
}

const RETRY: ReadonlySet<FillErrorCode> = new Set(["busy", "unavailable", "unreachable", "timeout"])

type Active = {
  start: LearningStart
  baseline: Map<string, string>
  finals: Map<string, string>
  mappings: Map<string, FieldMapping>
  detach: () => void
  idle?: ReturnType<typeof setTimeout>
  run?: Promise<void>
}

/**
 * What the person does after a fill, sent to the worker as one batch of field events: on submit, when the page is
 * hidden or left, or after a quiet spell. A batch is built once with its own id and a retry sends the same message, so
 * the server can tell a repeat from a new batch. Values stay in this frame until the batch is sent.
 */
export function createLearningSession({
  send,
  doc = document,
  win = window,
  url = () => location.href,
  newBatchId = () => crypto.randomUUID(),
  idleMs = LEARNING_IDLE_MS,
  retryDelaysMs = LEARNING_RETRY_DELAYS_MS,
}: LearningSessionDeps): LearningSession {
  let current: Active | null = null

  function build(active: Active): LearningRecordMessage | null {
    const site = siteKey(url())
    if (!site) return null
    const events = buildEvents(active.start.fields, (field) => {
      const filled = active.baseline.get(field.id) ?? ""
      return { filled, final: active.finals.get(field.id) ?? filled, mapping: active.mappings.get(field.id) }
    })
    return events.length > 0 ? { type: "learning-record", siteKey: site, batchId: newBatchId(), events } : null
  }

  /** "refused": the worker did not answer at all (the tab is not the active one), so nothing was recorded. */
  async function deliver(message: LearningRecordMessage): Promise<"done" | "refused"> {
    for (let attempt = 0; ; attempt++) {
      let reply: unknown
      try {
        reply = await send(message)
      } catch {
        reply = null
      }
      if (reply === undefined) return "refused"
      const parsed = learningRecordResponseSchema.safeParse(reply)
      if (parsed.success && parsed.data.ok) return "done"
      const retry = !parsed.success || (!parsed.data.ok && RETRY.has(parsed.data.code))
      const delay = retryDelaysMs[attempt]
      if (!retry || delay === undefined) return "done"
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  function end(active: Active): void {
    clearTimeout(active.idle)
    active.detach()
    if (current === active) current = null
  }

  function flushActive(active: Active): Promise<void> {
    active.run ??= (async () => {
      clearTimeout(active.idle)
      const message = build(active)
      const outcome = message ? await deliver(message) : "done"
      if (outcome === "done") end(active)
      else active.run = undefined
    })()
    return active.run
  }

  return {
    begin(start) {
      const previous = current
      if (previous) void flushActive(previous).then(() => end(previous))
      const baseline = new Map<string, string>()
      for (const field of start.summary.fields) {
        if (field.status === "filled" && field.value !== undefined) baseline.set(field.id, field.value)
      }
      const active: Active = {
        start,
        baseline,
        finals: new Map(),
        mappings: new Map(start.mapping.map((entry) => [entry.id, entry])),
        detach: () => {},
      }
      const rearm = () => {
        clearTimeout(active.idle)
        active.idle = setTimeout(() => void flushActive(active), idleMs)
      }
      const stopEdits = watchEdits(
        start.root,
        start.summary,
        (report) => {
          active.finals.set(report.fieldId, report.finalValue)
          rearm()
        },
        start.fields.map((field) => field.id),
      )
      const onSubmit = () => void flushActive(active)
      const onHide = () => {
        if (doc.visibilityState === "hidden") void flushActive(active)
      }
      const onLeave = () => void flushActive(active)
      doc.addEventListener("submit", onSubmit, true)
      doc.addEventListener("visibilitychange", onHide)
      win.addEventListener("pagehide", onLeave)
      active.detach = () => {
        stopEdits()
        doc.removeEventListener("submit", onSubmit, true)
        doc.removeEventListener("visibilitychange", onHide)
        win.removeEventListener("pagehide", onLeave)
      }
      current = active
      rearm()
    },
    flush: () => (current ? flushActive(current) : Promise.resolve()),
    stop() {
      if (current) end(current)
    },
  }
}
