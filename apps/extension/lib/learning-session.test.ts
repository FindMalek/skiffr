import { describe, expect, test } from "bun:test"
import { collectFields, fillPage } from "./fill"
import { mount, trusted } from "./fill/test-dom"
import { createLearningSession } from "./learning-session"
import type { LearningRecordMessage } from "./messages"

const FORM = `<form id="app">
  <label for="first">First name</label><input id="first" type="text">
  <label for="city">City</label><input id="city" type="text">
  <label for="why">Why us</label><textarea id="why"></textarea>
  <label for="pw">Password</label><input id="pw" type="password">
</form>
<form id="header"><input id="q" type="text" aria-label="Search the site"></form>`

async function setup(
  reply: (attempt: number) => unknown = () => ({ ok: true }),
  options: {
    html?: string
    idleMs?: number
    retryDelaysMs?: number[]
    onSubmitted?: () => void
    activated?: () => boolean
  } = {},
) {
  const { document, window, $ } = mount(options.html ?? FORM)
  const fields = collectFields(document).filter(
    (field) => field.descriptor.type !== "password" && field.descriptor.label !== "Search the site",
  )
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
    onSubmitted: options.onSubmitted,
    ...("activated" in options ? { activated: options.activated } : { activated: () => true }),
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
    $,
    fields,
    submit: (selector = "#app") => fire($(selector), "submit"),
    fire,
    document,
    window: window as unknown as Window,
  }
}

const byLabel = (message: LearningRecordMessage | undefined, label: string) =>
  message?.events.find((event) => event.label === label)

describe("learning session", () => {
  test("the person submitting the application form is reported, a scripted or other form's submit is not", async () => {
    let submitted = 0
    const { submit, fire, $ } = await setup(undefined, { onSubmitted: () => submitted++ })
    submit("#header")
    fire($("#app"), "submit", false)
    expect(submitted).toBe(0)
    submit()
    expect(submitted).toBe(1)
  })

  test("a trusted submit with no recent click or key press (a script's requestSubmit) is not reported, the batch still goes", async () => {
    let submitted = 0
    let active = false
    const { sent, submit } = await setup(undefined, { onSubmitted: () => submitted++, activated: () => active })
    submit()
    expect(submitted).toBe(0)
    expect(sent).toHaveLength(1)
    active = true
    submit()
    expect(submitted).toBe(1)
  })

  test("without the user activation api nothing is reported", async () => {
    let submitted = 0
    const { submit } = await setup(undefined, { onSubmitted: () => submitted++, activated: undefined })
    submit()
    expect(submitted).toBe(0)
  })

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
    const { sent, submit, fire, window } = await setup()
    submit()
    submit()
    fire(window, "pagehide")
    await Bun.sleep(5)
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

  test("a second fill adds its fields to the open session and sends nothing yet", async () => {
    const { session, sent, type, submit, document, fields } = await setup()
    type("#first", "Grace")
    const why = fields.find((field) => field.descriptor.label === "Why us") as (typeof fields)[number]
    const mapping = [{ id: why.id, action: "profile" as const, key: "why", confidence: 1, reason: "" }]
    const summary = await fillPage({ root: document, fields: [why], mapping, values: { why: "Because" } })
    session.begin({ root: document, fields: [why], mapping, summary })
    expect(sent).toHaveLength(0)

    submit()
    expect(sent).toHaveLength(1)
    expect(byLabel(sent[0], "First name")?.finalValue).toBe("Grace")
    expect(byLabel(sent[0], "Why us")).toMatchObject({ filledValue: "Because", finalValue: "Because" })
  })

  test("a submit of a form that holds none of the fields sends nothing", async () => {
    const { sent, submit, type, $ } = await setup()
    type("#first", "Grace")
    ;($("#q") as HTMLInputElement).value = "my secret search"
    submit("#header")
    expect(sent).toHaveLength(0)
    submit()
    expect(JSON.stringify(sent)).not.toContain("secret search")
  })

  test("a submit stopped by the page is still seen, and the fixed value goes out in a follow-up", async () => {
    const { sent, type, submit, $ } = await setup()
    $("#app").addEventListener("submit", (event) => event.stopPropagation())
    type("#city", "Lisbon typo")
    submit()
    await Bun.sleep(5)
    type("#city", "Lisbon fixed")
    submit()

    expect(sent).toHaveLength(2)
    expect(sent[1]?.batchId).not.toBe(sent[0]?.batchId)
    expect(byLabel(sent[0], "City")?.finalValue).toBe("Lisbon typo")
    expect(byLabel(sent[1], "City")).toMatchObject({ filledValue: "Lisbon", finalValue: "Lisbon fixed" })
  })

  test("follow-ups stop after a few batches", async () => {
    const { sent, type, submit } = await setup()
    for (let i = 0; i < 6; i++) {
      type("#city", `City ${i}`)
      submit()
      await Bun.sleep(5)
    }
    expect(sent).toHaveLength(3)
  })

  test("a field relabelled after the fill is not recorded", async () => {
    const { sent, type, submit, document } = await setup()
    type("#first", "X1234567")
    ;(document.querySelector("label[for=first]") as HTMLElement).textContent = "Passport number"
    submit()
    expect(JSON.stringify(sent)).not.toContain("X1234567")
    expect(byLabel(sent[0], "City")).toBeDefined()
  })

  test("a control the page swapped in after the fill is read where it stands, not recorded as accepted", async () => {
    const { sent, submit, $ } = await setup()
    const old = $<HTMLInputElement>("#city")
    const swapped = old.cloneNode() as HTMLInputElement
    swapped.value = "Porto"
    old.replaceWith(swapped)
    submit()
    expect(byLabel(sent[0], "City")).toMatchObject({ filledValue: "Lisbon", finalValue: "Porto" })
  })

  test("a field that left the page goes out as a batch of its own with what the person left in it", async () => {
    const { sent, type, submit, $ } = await setup()
    type("#city", "Porto")
    $("#city").remove()
    submit()
    await Bun.sleep(5)
    expect(sent).toHaveLength(2)
    expect(sent[0]?.events.map((event) => event.label)).toEqual(["City"])
    expect(byLabel(sent[0], "City")).toMatchObject({ filledValue: "Lisbon", finalValue: "Porto" })
    expect(byLabel(sent[1], "City")).toBeUndefined()
    expect(byLabel(sent[1], "First name")).toBeDefined()
  })

  test("a multi step form: step one goes out when the step is replaced and filled again, step two on submit", async () => {
    const { sent, type, submit, $, document, session } = await setup()
    type("#first", "Grace")
    $("#app").outerHTML = `<form id="app"><label for="phone">Phone</label><input id="phone" type="text"></form>`
    const [phone] = collectFields(document).filter((field) => field.descriptor.label === "Phone")
    const field = phone as NonNullable<typeof phone>
    const mapping = [{ id: field.id, action: "profile" as const, key: "p", confidence: 1, reason: "" }]
    const summary = await fillPage({ root: document, fields: [field], mapping, values: { p: "+351 1" } })
    session.begin({ root: document, fields: [field], mapping, summary })
    await Bun.sleep(5)
    expect(sent).toHaveLength(1)
    expect(byLabel(sent[0], "First name")).toMatchObject({ filledValue: "Ada", finalValue: "Grace" })

    type("#phone", "+351 2")
    submit()
    await Bun.sleep(5)
    expect(sent).toHaveLength(2)
    expect(sent[1]?.events.map((event) => event.label)).toEqual(["Phone"])
    expect(byLabel(sent[1], "Phone")).toMatchObject({ filledValue: "+351 1", finalValue: "+351 2" })
  })

  test("a follow-up carries only what changed: one correction is one corrected event", async () => {
    const { sent, type, submit } = await setup()
    type("#city", "Porto")
    submit()
    await Bun.sleep(5)
    type("#first", "Grace")
    submit()
    await Bun.sleep(5)
    type("#why", "Because")
    submit()
    await Bun.sleep(5)

    expect(sent).toHaveLength(3)
    const corrected = (label: string) =>
      sent.filter((message) => {
        const event = byLabel(message, label)
        return event && event.finalValue !== "" && event.finalValue !== event.filledValue
      }).length
    expect(corrected("City")).toBe(1)
    expect(corrected("First name")).toBe(1)
    expect(corrected("Why us")).toBe(1)
    const labels = (message: LearningRecordMessage | undefined) => message?.events.map((event) => event.label)
    expect(labels(sent[1])).toEqual(labels(sent[0]))
    expect(labels(sent[2])).toEqual(labels(sent[0]))
    expect(byLabel(sent[2], "City")).toMatchObject({ filledValue: "", finalValue: "" })
  })

  test("text typed in an empty field before the fill landed is not recorded as empty", async () => {
    const { sent, submit, $ } = await setup()
    $<HTMLTextAreaElement>("#why").value = "typed during fill"
    submit()
    expect(byLabel(sent[0], "Why us")).toMatchObject({ filledValue: "", finalValue: "typed during fill" })
  })

  test("a search box in the form is kept as a blank entry, never with its text", async () => {
    const html = `<form id="app"><label for="first">First name</label><input id="first" type="text">
      <label for="s">Quick search</label><input id="s" type="text"></form>`
    const { sent, type, submit } = await setup(undefined, { html })
    type("#s", "my secret search")
    submit()
    expect(byLabel(sent[0], "Quick search")).toMatchObject({ filledValue: "", finalValue: "" })
    expect(JSON.stringify(sent)).not.toContain("secret search")
  })

  test("a field of another form is kept as a blank entry, never with its text", async () => {
    const html = `<form id="app"><label for="first">First name</label><input id="first" type="text">
      <label for="city">City</label><input id="city" type="text"></form>
      <form id="other"><label for="nick">Nickname</label><input id="nick" type="text"></form>`
    const { sent, type, submit } = await setup(undefined, { html })
    type("#nick", "Gracie")
    submit()
    expect(byLabel(sent[0], "Nickname")).toMatchObject({ filledValue: "", finalValue: "" })
    expect(JSON.stringify(sent)).not.toContain("Gracie")
  })

  test("a field relabelled to something harmless is kept as a blank entry, never with its text", async () => {
    const { sent, type, submit, document } = await setup()
    type("#city", "Porto")
    ;(document.querySelector("label[for=city]") as HTMLElement).textContent = "Favorite color"
    submit()
    expect(byLabel(sent[0], "City")).toMatchObject({ filledValue: "", finalValue: "" })
    expect(JSON.stringify(sent)).not.toContain("Porto")
    expect(JSON.stringify(sent)).not.toContain("Favorite color")
  })

  test("at most 60 events go out in a batch", async () => {
    const inputs = Array.from({ length: 70 }, (_, i) => `<label for="q${i}">Question ${i}</label><input id="q${i}">`)
    const { sent, submit } = await setup(undefined, { html: `<form id="app">${inputs.join("")}</form>` })
    submit()
    expect(sent[0]?.events).toHaveLength(60)
  })

  test("a batch stays under the request size the api takes", async () => {
    const options = Array.from({ length: 50 }, (_, i) => `<option>${String(i).padEnd(100, "x")}</option>`).join("")
    const selects = Array.from(
      { length: 40 },
      (_, i) => `<label for="s${i}">Pick ${i}</label><select id="s${i}">${options}</select>`,
    )
    const { sent, submit } = await setup(undefined, { html: `<form id="app">${selects.join("")}</form>` })
    submit()
    const size = (sent[0]?.events ?? []).reduce(
      (sum, event) =>
        sum + event.label.length + event.options.join("").length + event.filledValue.length + event.finalValue.length,
      0,
    )
    expect(size).toBeLessThanOrEqual(100_000)
    expect(sent[0]?.events.length).toBeLessThan(40)
  })

  test("a long value is cut just past the autofill limit", async () => {
    const { sent, type, submit } = await setup()
    type("#why", "y".repeat(500))
    submit()
    expect(byLabel(sent[0], "Why us")?.finalValue).toHaveLength(301)
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
