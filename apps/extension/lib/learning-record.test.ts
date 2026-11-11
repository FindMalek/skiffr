import { expect, test } from "bun:test"
import { ORPCError } from "@orpc/client"
import type { FillSender } from "./fill-request"
import { createLearningRecordHandler } from "./learning-record"

const BATCH = "0b5c7a62-3f0e-4c0e-9a39-0d2e8a3f2f11"

const event = (extra: object = {}) => ({
  label: "First name",
  type: "text",
  options: [],
  filledValue: "Ada",
  finalValue: "Ada Lovelace",
  source: "profile",
  ...extra,
})

const message = (extra: object = {}) => ({
  type: "learning-record",
  siteKey: "jobs.example.com",
  batchId: BATCH,
  events: [event()],
  ...extra,
})

const sender = (extra: Partial<FillSender> = {}): FillSender => ({
  id: "ext",
  url: "https://jobs.example.com/apply",
  frameId: 0,
  documentLifecycle: "active",
  tab: { id: 1, active: true },
  ...extra,
})

function setup(options: { trusted?: boolean; fail?: unknown; hold?: Promise<void> } = {}) {
  const recorded: unknown[] = []
  let time = 0
  const handler = createLearningRecordHandler({
    extensionId: "ext",
    extensionUrl: "chrome-extension://ext/",
    isTrustedFrame: async () => options.trusted ?? true,
    now: () => time,
    call: async (run) =>
      run({
        learning: {
          record: async (input: unknown) => {
            recorded.push(input)
            await options.hold
            if (options.fail) throw options.fail
            return {}
          },
        },
      } as never),
  })
  return {
    handler,
    recorded,
    advance: (ms: number) => {
      time += ms
    },
  }
}

test("a batch from the active tab is recorded with its batch id", async () => {
  const { handler, recorded } = setup()
  expect(await handler.handle(message(), sender())).toEqual({ ok: true })
  expect(recorded).toEqual([{ siteKey: "jobs.example.com", batchId: BATCH, events: [event()] }])
})

test("other messages are left alone", () => {
  expect(setup().handler.handle({ type: "fill-request" }, sender())).toBeUndefined()
})

test("a wrong sender gets no answer and nothing reaches the api", () => {
  const { handler, recorded } = setup()
  const bad: FillSender[] = [
    sender({ id: "other" }),
    sender({ tab: { id: 1, active: false } }),
    sender({ url: "chrome-extension://ext/options.html" }),
    sender({ documentLifecycle: "prerender" }),
    sender({ frameId: undefined }),
  ]
  for (const from of bad) expect(handler.handle(message(), from)).toBeUndefined()
  expect(recorded).toEqual([])
})

test("a site key that is not the sender's site, or a message past the caps, is invalid", async () => {
  const { handler, recorded } = setup()
  const tooMany = Array.from({ length: 61 }, (_, i) => event({ label: `Question ${i}` }))
  for (const bad of [
    message({ siteKey: "evil.example.com" }),
    message({ events: tooMany }),
    message({ events: [] }),
    message({ batchId: "not-a-uuid" }),
    message({ extra: true }),
    message({ events: [event({ finalValue: "x".repeat(2_001) })] }),
  ]) {
    expect(await handler.handle(bad, sender())).toEqual({ ok: false, code: "invalid" })
  }
  expect(recorded).toEqual([])
})

test("a child frame the frame logic does not trust is invalid", async () => {
  const { handler, recorded } = setup({ trusted: false })
  expect(await handler.handle(message(), sender({ frameId: 3 }))).toEqual({ ok: false, code: "invalid" })
  expect(recorded).toEqual([])
})

test("private fields and card-like values are dropped before the api", async () => {
  const { handler, recorded } = setup()
  await handler.handle(
    message({
      events: [
        event({ label: "Password", type: "password", finalValue: "hunter2" }),
        event({ label: "Social security number" }),
        event({ label: "Reference", filledValue: "", finalValue: "4242 4242 4242 4242" }),
      ],
    }),
    sender(),
  )
  const [input] = recorded as { events: { label: string; finalValue: string }[] }[]
  expect(input?.events).toEqual([event({ label: "Reference", filledValue: "", finalValue: "" })])
})

test("a batch with nothing recordable never reaches the api", async () => {
  const { handler, recorded } = setup()
  const events = [event({ label: "Password", type: "password" })]
  expect(await handler.handle(message({ events }), sender())).toEqual({ ok: true })
  expect(recorded).toEqual([])
})

test("one batch per tab at a time", async () => {
  let release: () => void = () => {}
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })
  const { handler, recorded } = setup({ hold })
  const first = handler.handle(message(), sender())
  expect(await handler.handle(message(), sender())).toEqual({ ok: false, code: "busy" })
  release()
  expect(await first).toEqual({ ok: true })
  expect(await handler.handle(message(), sender())).toEqual({ ok: true })
  expect(recorded).toHaveLength(2)
})

test("a tab is held to its cap per minute", async () => {
  const { handler, advance } = setup()
  for (let i = 0; i < 12; i++) expect(await handler.handle(message(), sender())).toEqual({ ok: true })
  expect(await handler.handle(message(), sender())).toEqual({ ok: false, code: "busy" })
  advance(61_000)
  expect(await handler.handle(message(), sender())).toEqual({ ok: true })
})

test("an api failure comes back as a class, never its text", async () => {
  const { handler } = setup({ fail: new ORPCError("INTERNAL_SERVER_ERROR", { status: 503, message: "secret detail" }) })
  expect(await handler.handle(message(), sender())).toEqual({ ok: false, code: "unavailable" })
})
