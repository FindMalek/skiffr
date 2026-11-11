import { expect, test } from "bun:test"
import { createFillRequestHandler, type FillSender } from "./fill-request"
import type { FillService } from "./fill-service"
import type { FillRequestMessage } from "./messages"

const OK = {
  ok: true as const,
  mapping: [],
  values: {},
  suggestions: [],
  summary: { site: 0, exact: 0, label: 0, profile: 0, generated: 0, review: 0, suggested: 0, skipped: 0 },
}

function setup(trusted = true) {
  const runs: FillRequestMessage[] = []
  const service: FillService = {
    run: async (request) => {
      runs.push(request)
      return OK
    },
    clear: () => {},
  }
  let time = 0
  const handler = createFillRequestHandler({
    extensionId: "ext",
    extensionUrl: "chrome-extension://ext/",
    service,
    isTrustedFrame: async () => trusted,
    now: () => time,
  })
  return {
    handler,
    runs,
    advance: (ms: number) => {
      time += ms
    },
  }
}

const message = (extra: object = {}) => ({
  type: "fill-request",
  siteKey: "jobs.example.com",
  fields: [{ id: "a", label: "Name", type: "text", options: [] }],
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

test("a content script of the active tab gets an answer", async () => {
  const { handler, runs } = setup()
  expect(await handler.handle(message(), sender())).toEqual(OK)
  expect(runs).toHaveLength(1)
})

test("other messages are left alone", () => {
  expect(setup().handler.handle({ type: "fill" }, sender())).toBeUndefined()
})

test("a wrong sender gets no answer and nothing reaches the api", () => {
  const { handler, runs } = setup()
  const bad: FillSender[] = [
    sender({ id: "other" }),
    sender({ tab: undefined }),
    sender({ tab: { id: 1, active: false } }),
    sender({ frameId: undefined }),
    sender({ url: undefined }),
    sender({ url: "chrome-extension://ext/options.html" }),
    sender({ documentLifecycle: "prerender" }),
  ]
  for (const from of bad) expect(handler.handle(message(), from)).toBeUndefined()
  expect(runs).toEqual([])
})

test("malformed, oversized and mismatched requests are rejected before the api", async () => {
  const { handler, runs } = setup()
  const field = (i: number) => ({ id: `f${i}`, label: "x", options: [] })
  const many = Array.from({ length: 301 }, (_, i) => field(i))
  const bad = [
    message({ fields: [] }),
    message({ fields: many }),
    message({ fields: [{ id: "a", label: "x".repeat(301), options: [] }] }),
    message({ fields: [{ id: "a", options: Array(51).fill("o") }] }),
    message({ fields: [field(1), field(1)] }),
    message({ fields: [{ id: "a", options: [], value: "typed text" }] }),
    message({ extra: true }),
    message({ siteKey: "NOT A KEY" }),
    message({ siteKey: "other.example.com" }),
    { type: "fill-request" },
  ]
  for (const request of bad) expect(await handler.handle(request, sender())).toEqual({ ok: false, code: "invalid" })
  expect(runs).toEqual([])
})

test("a child frame is served only when the frame logic trusts it", async () => {
  const child = sender({ frameId: 3, url: "https://jobs.example.com/embed", documentId: "d" })
  const trusted = setup(true)
  expect(await trusted.handler.handle(message(), child)).toEqual(OK)
  const untrusted = setup(false)
  expect(await untrusted.handler.handle(message(), child)).toEqual({ ok: false, code: "invalid" })
  expect(untrusted.runs).toEqual([])
})

test("a tab is limited, and the limit resets with time and per tab", async () => {
  const { handler, runs, advance } = setup()
  for (let i = 0; i < 10; i++) await handler.handle(message(), sender())
  expect(await handler.handle(message(), sender())).toEqual({ ok: false, code: "busy" })
  expect(runs).toHaveLength(10)
  expect(await handler.handle(message(), sender({ tab: { id: 2, active: true } }))).toEqual(OK)
  advance(60_000)
  expect(await handler.handle(message(), sender())).toEqual(OK)
  handler.forgetTab(1)
})

test("closing the tab stops the api work still running for it", async () => {
  let seen: AbortSignal | undefined
  const handler = createFillRequestHandler({
    extensionId: "ext",
    extensionUrl: "chrome-extension://ext/",
    service: {
      run: async (_request, signal) => {
        seen = signal
        return OK
      },
      clear: () => {},
    },
    isTrustedFrame: async () => true,
  })
  await handler.handle(message(), sender())
  expect(seen?.aborted).toBe(false)
  handler.forgetTab(1)
  expect(seen?.aborted).toBe(true)
})
