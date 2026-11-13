import { siteKey } from "./detect/ats"
import { type CollectedField, type FieldMapping, type FillSummary, watchEdits } from "./fill"
import { type FillErrorCode, LEARNING_BATCHES_MAX, LEARNING_IDLE_MS, LEARNING_RETRY_DELAYS_MS } from "./fill-config"
import { buildEvents } from "./learning-events"
import { type LiveField, liveFields } from "./learning-fields"
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
  /**
   * The main form of the application was submitted by a trusted submit event while the person's click or key press was
   * recent. A page script can still call `requestSubmit()` right after any click of the person, so this is a hint to
   * ask, never a proof that they applied: everything it leads to waits for their own choice.
   */
  onSubmitted?: () => void
  /** Whether the person acted on the page a moment ago (transient user activation). */
  activated?: () => boolean
}

export type LearningSession = {
  /** Starts watching the fields of a fill. A fill while a session is open adds its fields to it. */
  begin: (start: LearningStart) => void
  /** Drops the open session without sending it. */
  stop: () => void
}

const RETRY: ReadonlySet<FillErrorCode> = new Set(["busy", "unavailable", "unreachable", "timeout"])

/** The form that holds at least half of the fields on the page now. A field in another form (a header search) is not part of the application. */
function mainForm(entries: LiveField[]): HTMLFormElement | null {
  const here = entries.filter((entry) => !entry.gone)
  const counts = new Map<HTMLFormElement, number>()
  for (const { field } of here) {
    const form = (field.el as HTMLInputElement).form
    if (form) counts.set(form, (counts.get(form) ?? 0) + 1)
  }
  const [best] = [...counts].sort((a, b) => b[1] - a[1])
  return best && best[1] * 2 >= here.length ? best[0] : null
}

type Active = {
  roots: ParentNode[]
  fields: CollectedField[]
  /** What the fill put in each field. */
  baseline: Map<string, string>
  /** Fields where the page shows less than the fill wrote (the dial code of a phone): untouched, they teach nothing. */
  moved: Set<string>
  /** What the person left in a field they edited, from trusted gestures only. */
  finals: Map<string, string>
  mappings: Map<string, FieldMapping>
  /** The value each field had in the last batch that was delivered. A follow-up repeats only what changed since. */
  sent: Map<string, string>
  retiring?: Promise<void>
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
  onSubmitted,
  activated = () => win.navigator.userActivation?.isActive === true,
}: LearningSessionDeps): LearningSession {
  let current: Active | null = null

  type Built = { message: LearningRecordMessage; values: Map<string, string> }

  function build(active: Active, entries: LiveField[]): Built | null {
    const site = siteKey(url())
    if (!site) return null
    const main = mainForm(entries)
    const byId = new Map(entries.map((entry) => [entry.field.id, entry]))
    const values = new Map<string, string>()
    const events = buildEvents(
      entries.map((entry) => entry.field),
      (field) => {
        const entry = byId.get(field.id) as LiveField
        const mapping = active.mappings.get(field.id)
        const form = (field.el as HTMLInputElement).form
        if (entry.blank || (main && !entry.gone && form && form !== main)) return { filled: "", final: "", mapping }
        const filled = active.baseline.get(field.id) ?? ""
        const edited = active.finals.get(field.id)
        // a control the page swapped in was never watched, and a field the fill left empty holds what was typed in it
        const read = entry.replaced || (edited === undefined && filled === "")
        const final = entry.gone ? (edited ?? filled) : read ? entry.value : (edited ?? filled)
        values.set(field.id, final)
        // a field that did not change since the last delivered batch stays in the form but counts for nothing
        if (active.sent.get(field.id) === final) return { filled: "", final: "", mapping }
        if (active.moved.has(field.id) && final === filled) return { filled: "", final: "", mapping }
        return { filled, final, mapping }
      },
    )
    return events.length > 0
      ? { message: { type: "learning-record", siteKey: site, batchId: newBatchId(), events }, values }
      : null
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

  /** Fields whose control left the page (the next step of a form) go out as a batch of their own, then leave the session. */
  function retire(active: Active): Promise<void> {
    active.retiring ??= (async () => {
      const gone = liveFields(active.roots, active.fields).filter((entry) => entry.gone)
      const built = gone.length > 0 ? build(active, gone) : null
      if (!built || (await deliver(built.message)) === "refused") return
      const ids = new Set(gone.map((entry) => entry.field.id))
      active.fields = active.fields.filter((field) => !ids.has(field.id))
      for (const id of ids) {
        active.baseline.delete(id)
        active.finals.delete(id)
        active.mappings.delete(id)
        active.sent.delete(id)
        active.moved.delete(id)
      }
    })().finally(() => {
      active.retiring = undefined
    })
    return active.retiring
  }

  async function sendBatch(active: Active): Promise<void> {
    clearTimeout(active.idle)
    let entries = liveFields(active.roots, active.fields)
    if (entries.some((entry) => entry.gone)) {
      await retire(active)
      entries = liveFields(active.roots, active.fields)
    }
    active.dirty = false
    const built = build(active, entries)
    if (!built) return end(active)
    if ((await deliver(built.message)) === "refused") {
      active.dirty = true
      return
    }
    for (const [id, value] of built.values) active.sent.set(id, value)
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
    void retire(active)
    if (!active.roots.includes(start.root)) active.roots.push(start.root)
    const known = new Set(active.fields.map((field) => field.id))
    for (const field of start.fields) if (!known.has(field.id)) active.fields.push(field)
    for (const field of start.summary.fields) {
      if (field.status !== "filled" || field.value === undefined) continue
      active.baseline.set(field.id, field.value)
      active.finals.delete(field.id)
      if (field.moved) active.moved.add(field.id)
      else active.moved.delete(field.id)
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
      moved: new Set(),
      finals: new Map(),
      mappings: new Map(),
      sent: new Map(),
      stops: [],
      detach: () => {},
      dirty: true,
      batches: 0,
    }
    const onSubmit = (event: Event) => {
      const entries = liveFields(active.roots, active.fields)
      const main = mainForm(entries)
      const holds = entries.some((entry) => !entry.gone && (entry.field.el as HTMLInputElement).form === event.target)
      if (!(main ? event.target === main : holds)) return
      flush(active)
      if (event.isTrusted && activated()) onSubmitted?.()
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
