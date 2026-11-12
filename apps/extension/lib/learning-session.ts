import { siteKey } from "./detect/ats"
import { type CollectedField, type FieldMapping, type FillSummary, watchEdits } from "./fill"
import { type FillErrorCode, LEARNING_BATCHES_MAX, LEARNING_IDLE_MS, LEARNING_RETRY_DELAYS_MS } from "./fill-config"
import { buildEvents } from "./learning-events"
import { liveFields } from "./learning-fields"
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
  /** Starts watching the fields of a fill. A fill while a session is open adds its fields to it. */
  begin: (start: LearningStart) => void
  /** Drops the open session without sending it. */
  stop: () => void
}

const RETRY: ReadonlySet<FillErrorCode> = new Set(["busy", "unavailable", "unreachable", "timeout"])

/** The form that holds at least half of the watched fields. A field in another form (a header search) is not part of the application. */
function mainForm(fields: CollectedField[]): HTMLFormElement | null {
  const counts = new Map<HTMLFormElement, number>()
  for (const { el } of fields) {
    const form = (el as HTMLInputElement).form
    if (form) counts.set(form, (counts.get(form) ?? 0) + 1)
  }
  const [best] = [...counts].sort((a, b) => b[1] - a[1])
  return best && best[1] * 2 >= fields.length ? best[0] : null
}

type Active = {
  roots: ParentNode[]
  fields: CollectedField[]
  /** What the fill put in each field. */
  baseline: Map<string, string>
  /** What the person left in a field they edited, from trusted gestures only. */
  finals: Map<string, string>
  mappings: Map<string, FieldMapping>
  stops: (() => void)[]
  detach: () => void
  idle?: ReturnType<typeof setTimeout>
  run?: Promise<void>
  /** Something to learn since the last batch was built. */
  dirty: boolean
  batches: number
}

/**
 * What the person does after a fill, sent to the worker as a batch of field events: on submit of a form that holds the
 * fields, when the page is hidden or left, or after a quiet spell. A batch is built once with its own id and a retry
 * sends the same message, so the server can tell a repeat from a new batch. The session keeps watching after a batch
 * and sends a follow-up for later edits (a submit the page stopped, a fixed value). Events are made from the fields as
 * they are when the batch is built, not as they were at the fill. Values stay in this frame until a batch is sent.
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
    const main = mainForm(active.fields)
    const own = liveFields(active.roots, active.fields).filter((entry) => {
      const form = (entry.field.el as HTMLInputElement).form
      return !main || !form || form === main
    })
    const live = new Map(own.map((entry) => [entry.field.id, entry]))
    const events = buildEvents(
      Array.from(live.values(), (entry) => entry.field),
      (field) => {
        const { value, replaced } = live.get(field.id) as { value: string; replaced: boolean }
        const filled = active.baseline.get(field.id) ?? ""
        const edited = active.finals.get(field.id)
        // a control the page swapped in was never watched, and a field the fill left empty holds what was typed in it
        const final = replaced || (edited === undefined && filled === "") ? value : (edited ?? filled)
        return { filled, final, mapping: active.mappings.get(field.id) }
      },
    )
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

  async function sendBatch(active: Active): Promise<void> {
    clearTimeout(active.idle)
    active.dirty = false
    const message = build(active)
    if (!message) return end(active)
    if ((await deliver(message)) === "refused") {
      active.dirty = true
      return
    }
    active.batches++
    if (active.batches >= LEARNING_BATCHES_MAX) end(active)
  }

  function flush(active: Active): void {
    if (active.run || (active.batches > 0 && !active.dirty)) return
    active.run = sendBatch(active).finally(() => {
      active.run = undefined
    })
  }

  function rearm(active: Active): void {
    clearTimeout(active.idle)
    active.idle = setTimeout(() => flush(active), idleMs)
  }

  function watch(active: Active, start: LearningStart): void {
    active.stops.push(
      watchEdits(
        start.root,
        start.summary,
        (report) => {
          active.finals.set(report.fieldId, report.finalValue)
          active.dirty = true
          rearm(active)
        },
        start.fields.map((field) => field.id),
      ),
    )
  }

  function absorb(active: Active, start: LearningStart): void {
    if (!active.roots.includes(start.root)) active.roots.push(start.root)
    const known = new Set(active.fields.map((field) => field.id))
    for (const field of start.fields) if (!known.has(field.id)) active.fields.push(field)
    for (const field of start.summary.fields) {
      if (field.status !== "filled" || field.value === undefined) continue
      active.baseline.set(field.id, field.value)
      active.finals.delete(field.id)
    }
    for (const entry of start.mapping) active.mappings.set(entry.id, entry)
    watch(active, start)
    active.dirty = true
    rearm(active)
  }

  function open(start: LearningStart): Active {
    const active: Active = {
      roots: [start.root],
      fields: [...start.fields],
      baseline: new Map(),
      finals: new Map(),
      mappings: new Map(),
      stops: [],
      detach: () => {},
      dirty: true,
      batches: 0,
    }
    const onSubmit = (event: Event) => {
      const main = mainForm(active.fields)
      if (
        main
          ? event.target === main
          : active.fields.some((field) => (field.el as HTMLInputElement).form === event.target)
      )
        flush(active)
    }
    const onHide = () => {
      if (doc.visibilityState === "hidden") flush(active)
    }
    const onLeave = () => flush(active)
    doc.addEventListener("submit", onSubmit, true)
    doc.addEventListener("visibilitychange", onHide)
    win.addEventListener("pagehide", onLeave)
    active.detach = () => {
      for (const stop of active.stops.splice(0)) stop()
      doc.removeEventListener("submit", onSubmit, true)
      doc.removeEventListener("visibilitychange", onHide)
      win.removeEventListener("pagehide", onLeave)
    }
    return active
  }

  return {
    begin(start) {
      const active = current ?? open(start)
      current = active
      absorb(active, start)
    },
    stop() {
      if (current) end(current)
    },
  }
}
