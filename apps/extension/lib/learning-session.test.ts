import { describe, expect, test } from "bun:test"
import { collectFields, fillPage } from "./fill"
import { mount, trusted } from "./fill/test-dom"
import { createLearningSession } from "./learning-session"
import type { LearningRecordMessage } from "./messages"

const FORM = `
  <label for="first">First name</label><input id="first" type="text">
  <label for="city">City</label><input id="city" type="text">
  <label for="why">Why us</label><textarea id="why"></textarea>
  <label for="pw">Password</label><input id="pw" type="password">
`

async function setup(
  reply: (attempt: number) => unknown = () => ({ ok: true }),
  options: { html?: string; idleMs?: number; retryDelaysMs?: number[] } = {},
) {
  const { document, window, $ } = mount(options.html ?? FORM)
  const fields = collectFields(document).filter((field) => field.descriptor.type !== "password")
  const ids = new Map(fields.map((field) => [field.descriptor.label, field.id]))
  const mapping = [
    { id: ids.get("First name") as string, action: "profile" as const, key: "first", confidence: 1, reason: "" },
    { id: ids.get("City") as string, action: "profile" as const, key: "city", confidence: 1, reason: "" },
  ]
  const summary = await fillPage({ root: document, fields, mapping, values: { first: "Ada", city: "Lisbon" } })
  const sent: LearningRecordMessage[] = []
  const session = createLearningSession({
    send: async (message) => {
      sent.push(message)
      return reply(sent.length)
    },
    doc: document,
    win: window as unknown as Window,
    url: () => "https://jobs.example.com/apply",
    newBatchId: () => crypto.randomUUID(),
    idleMs: options.idleMs ?? 60_000,
    retryDelaysMs: options.retryDelaysMs ?? [1, 1],
  })
  session.begin({ root: document, fields, mapping, summary })
  const fire = (target: EventTarget, type: string, trustedEvent = true) => {
    const event = new (window as never as { Event: typeof Event }).Event(type, { bubbles: true })
    target.dispatchEvent(trustedEvent ? trusted(event) : event)
  }
  const type = (selector: string, value: string) => {
    const input = $<HTMLInputElement>(selector)
    fire(input, "keydown")
    input.value = value
    fire(input, "input")
    fire(input, "change")
  }
  return {
    session,
    sent,
    type,
    submit: () => fire(document, "submit"),
    fire,
    document,
    window: window as unknown as Window,
  }
}

const byLabel = (message: LearningRecordMessage | undefined, label: string) =>
  message?.events.find((event) => event.label === label)

describe("learning session", () => {
  test("submit sends one event for every field: corrected, untouched and never filled", async () => {
    const { sent, type, submit } = await setup()
    type("#first", "Ada Lovelace")
    submit()

    expect(sent).toHaveLength(1)
    expect(sent[0]?.siteKey).toBe("jobs.example.com")
    expect(byLabel(sent[0], "First name")).toMatchObject({
      filledValue: "Ada",
      finalValue: "Ada Lovelace",
      source: "profile",
    })
    expect(byLabel(sent[0], "City")).toMatchObject({ filledValue: "Lisbon", finalValue: "Lisbon" })
    expect(byLabel(sent[0], "Why us")).toMatchObject({ filledValue: "", finalValue: "", type: "textarea" })
  })

  test("a cleared field is sent with an empty final value", async () => {
    const { sent, type, submit } = await setup()
    type("#city", "")
    submit()
    expect(byLabel(sent[0], "City")).toMatchObject({ filledValue: "Lisbon", finalValue: "" })
  })

  test("a field the fill left empty and the person typed in is a correction from nothing", async () => {
    const { sent, type, submit } = await setup()
    type("#why", "I like the product")
    submit()
    expect(byLabel(sent[0], "Why us")).toMatchObject({ filledValue: "", finalValue: "I like the product" })
  })

  test("a page script changing a value is not an edit", async () => {
    const { sent, submit, document, fire } = await setup()
    const city = document.querySelector("#city") as HTMLInputElement
    city.value = "Porto"
    fire(city, "change", false)
    submit()
    expect(byLabel(sent[0], "City")).toMatchObject({ filledValue: "Lisbon", finalValue: "Lisbon" })
  })

  test("a batch is sent once, whatever fires next", async () => {
    const { sent, session, submit, fire, window } = await setup()
    submit()
    submit()
    fire(window, "pagehide")
    await session.flush()
    expect(sent).toHaveLength(1)
  })

  test("leaving the page sends the batch", async () => {
    const { sent, fire, window } = await setup()
    fire(window, "pagehide")
    expect(sent).toHaveLength(1)
  })

  test("the page going hidden sends the batch, becoming visible does not", async () => {
    const { sent, fire, document } = await setup()
    let state = "visible"
    Object.defineProperty(document, "visibilityState", { get: () => state })
    fire(document, "visibilitychange")
    expect(sent).toHaveLength(0)
    state = "hidden"
    fire(document, "visibilitychange")
    expect(sent).toHaveLength(1)
  })

  test("a quiet spell sends the batch, an edit restarts it", async () => {
    const { sent, type } = await setup(undefined, { idleMs: 40 })
    await Bun.sleep(25)
    type("#first", "Grace")
    await Bun.sleep(25)
    expect(sent).toHaveLength(0)
    await Bun.sleep(40)
    expect(sent).toHaveLength(1)
    expect(byLabel(sent[0], "First name")?.finalValue).toBe("Grace")
  })

  test("a failed send is repeated with the same batch id, within limits", async () => {
    const { sent, submit } = await setup(() => ({ ok: false, code: "unavailable" }))
    submit()
    await Bun.sleep(30)
    expect(sent).toHaveLength(3)
    expect(new Set(sent.map((message) => message.batchId)).size).toBe(1)
    expect(sent[1]).toEqual(sent[0] as LearningRecordMessage)
  })

  test("a send that works on the second try is not repeated again", async () => {
    const { sent, submit } = await setup((attempt) => (attempt === 1 ? { ok: false, code: "busy" } : { ok: true }))
    submit()
    await Bun.sleep(30)
    expect(sent).toHaveLength(2)
  })

  test("a refusal that a retry cannot fix is not repeated", async () => {
    const { sent, submit } = await setup(() => ({ ok: false, code: "rejected" }))
    submit()
    await Bun.sleep(20)
    expect(sent).toHaveLength(1)
  })

  test("a worker that does not answer is retried", async () => {
    const { sent, submit } = await setup(() => {
      throw new Error("no receiver")
    })
    submit()
    await Bun.sleep(30)
    expect(sent).toHaveLength(3)
  })

  test("a batch the worker would not take (tab not active) stays open and goes out later with the new edits", async () => {
    const { sent, type, submit, window, fire } = await setup((attempt) => (attempt === 1 ? undefined : { ok: true }))
    fire(window, "pagehide")
    expect(sent).toHaveLength(1)
    await Bun.sleep(5)
    type("#first", "Grace")
    submit()
    expect(sent).toHaveLength(2)
    expect(sent[1]?.batchId).toBeDefined()
    expect(byLabel(sent[1], "First name")?.finalValue).toBe("Grace")
  })

  test("a new fill sends the session still open before it starts its own", async () => {
    const { session, sent, document } = await setup()
    session.begin({
      root: document,
      fields: [],
      mapping: [],
      summary: { fields: [], counts: {} as never, clearHighlights: () => {} },
    })
    expect(sent).toHaveLength(1)
  })

  test("passwords, private labels and card numbers never leave the frame", async () => {
    const html = `${FORM}
      <label for="ssn">Social security number</label><input id="ssn" type="text">
      <label for="ref">Reference</label><input id="ref" type="text">`
    const { sent, type, submit } = await setup(undefined, { html })
    type("#ref", "4242 4242 4242 4242")
    type("#ssn", "078-05-1120")
    submit()

    const text = JSON.stringify(sent)
    expect(text).not.toContain("4242")
    expect(text).not.toContain("078-05")
    expect(byLabel(sent[0], "Social security number")).toBeUndefined()
    expect(byLabel(sent[0], "Password")).toBeUndefined()
    expect(byLabel(sent[0], "Reference")).toMatchObject({ filledValue: "", finalValue: "" })
  })
})
