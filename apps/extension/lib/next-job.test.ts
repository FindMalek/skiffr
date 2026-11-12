import { expect, test } from "bun:test"
import { ORPCError } from "@orpc/client"
import { canonicalizeJob } from "@skiffr/common"
import type { FillSender } from "./fill-request"
import type { NextOfferMessage } from "./messages"
import { createNextJobHandler } from "./next-job"

type Memory = {
  get: (key: string) => Promise<Record<string, unknown>>
  set: (items: Record<string, unknown>) => Promise<void>
}
const memory = (): Memory => {
  const data: Record<string, unknown> = {}
  return {
    get: async (key) => ({ [key]: structuredClone(data[key]) }),
    set: async (items) => {
      Object.assign(data, structuredClone(items))
    },
  }
}

const PAGE = "https://job-boards.greenhouse.io/acme/jobs/111"
const OFFER_ID = "0b5c7a62-3f0e-4c0e-9a39-0d2e8a3f2f11"

const job = (n: number, url: string, extra: object = {}) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  url,
  canonicalId: canonicalizeJob(url).canonicalId,
  title: `Engineer ${n}`,
  company: `Co ${n}`,
  ...extra,
})

const submitted = (extra: object = {}) => ({
  type: "application-submitted",
  siteKey: "job-boards.greenhouse.io/acme",
  ...extra,
})

const sender = (extra: Partial<FillSender> = {}): FillSender => ({
  id: "ext",
  url: PAGE,
  frameId: 0,
  documentLifecycle: "active",
  tab: { id: 1, active: true },
  ...extra,
})

function setup(
  options: {
    jobs?: unknown
    fail?: unknown
    markFail?: unknown
    muted?: boolean
    trusted?: boolean
    /** The url the tab shows when the worker asks, after the list came back. */
    top?: () => string
    storage?: Memory
    hold?: Promise<void>
    time?: { now: number }
  } = {},
) {
  const calls: {
    list: unknown[]
    create: unknown[]
    opened: { url: string; windowId: number | undefined }[]
    muted: string[]
    offers: NextOfferMessage[]
  } = {
    list: [],
    create: [],
    opened: [],
    muted: [],
    offers: [],
  }
  const clock = options.time ?? { now: 0 }
  const storage = options.storage ?? memory()
  const handler = createNextJobHandler({
    extensionId: "ext",
    extensionUrl: "chrome-extension://ext/",
    isTrustedFrame: async () => options.trusted ?? true,
    topUrl: async () => options.top?.() ?? PAGE,
    storage,
    isMuted: async () => options.muted ?? false,
    mute: async (site) => void calls.muted.push(site),
    open: async (url, windowId) => void calls.opened.push({ url, windowId }),
    offer: (_tab, message) => void calls.offers.push(message),
    newId: () => OFFER_ID,
    now: () => clock.now,
    call: async (run) =>
      run({
        jobs: {
          list: async (input: unknown) => {
            calls.list.push(input)
            await options.hold
            if (options.fail) throw options.fail
            return options.jobs ?? []
          },
        },
        applications: {
          create: async (input: unknown) => {
            calls.create.push(input)
            if (options.markFail) throw options.markFail
            return {}
          },
        },
      } as never),
  })
  return {
    handler,
    calls,
    storage,
    advance: (ms: number) => {
      clock.now += ms
    },
  }
}

const queue = [
  job(1, PAGE),
  job(2, "https://jobs.lever.co/acme/2b1c5f57-0a6d-4c8e-9f1d-3a7e5d9c1b11"),
  job(3, "https://example.com/careers/3"),
]

test("a submit offers the next job and the one just submitted, found by its canonical id", async () => {
  const { handler, calls } = setup({ jobs: queue })
  expect(await handler.handle(submitted(), sender())).toEqual({ ok: true })
  expect(calls.list).toEqual([{ status: "queued", order: "oldest", limit: 100, offset: 0 }])
  expect(calls.offers).toEqual([
    {
      type: "next-offer",
      offerId: OFFER_ID,
      scope: "job-boards.greenhouse.io/acme",
      matched: { title: "Engineer 1", company: "Co 1" },
      next: { title: "Engineer 2", company: "Co 2" },
    },
  ])
  expect(calls.opened).toEqual([])
  expect(calls.create).toEqual([])
})

test("a tracking-param copy of the job link still matches", async () => {
  const { handler, calls } = setup({
    jobs: [job(1, "https://example.com/careers/1"), job(2, "https://example.com/careers/2")],
    top: () => "https://www.example.com/careers/1/?utm_source=x",
  })
  await handler.handle(
    submitted({ siteKey: "www.example.com" }),
    sender({ url: "https://www.example.com/careers/1/?utm_source=x" }),
  )
  expect(calls.offers[0]?.matched?.title).toBe("Engineer 1")
  expect(calls.offers[0]?.next?.title).toBe("Engineer 2")
})

test("a page that is not in the queue is offered the next job only", async () => {
  const { handler, calls } = setup({ jobs: [queue[1], queue[2]] })
  await handler.handle(submitted(), sender())
  expect(calls.offers[0]?.matched).toBeNull()
  expect(calls.offers[0]?.next?.title).toBe("Engineer 2")
})

test("nothing queued and no match means no offer", async () => {
  const { handler, calls } = setup({ jobs: [] })
  expect(await handler.handle(submitted(), sender())).toEqual({ ok: true })
  expect(calls.offers).toEqual([])
})

test("a job whose link is not a web address is never the next job", async () => {
  const { handler, calls } = setup({
    jobs: [
      job(2, "javascript:alert(1)"),
      job(3, "https://user:pw@evil.example/x"),
      job(4, "https://example.com/careers/4"),
    ],
  })
  await handler.handle(submitted(), sender())
  expect(calls.offers[0]?.next?.title).toBe("Engineer 4")
  const only = setup({ jobs: [job(2, "javascript:alert(1)")] })
  await only.handler.handle(submitted(), sender())
  expect(only.calls.offers).toEqual([])
})

test("job text is shown clean and short", async () => {
  const title = `${"A".repeat(200)}‮evil`
  const { handler, calls } = setup({ jobs: [job(2, "https://example.com/careers/2", { title })] })
  await handler.handle(submitted(), sender())
  const shown = calls.offers[0]?.next?.title ?? ""
  expect(shown.length).toBeLessThanOrEqual(61)
  expect(shown).not.toContain("‮")
})

test("a reply that does not look like jobs shows nothing", async () => {
  const { handler, calls } = setup({ jobs: [{ id: "x", title: 1 }] })
  expect(await handler.handle(submitted(), sender())).toMatchObject({ ok: false })
  expect(calls.offers).toEqual([])
})

test("the same page is asked about once, a failed read may be asked again", async () => {
  const { handler, calls } = setup({ jobs: queue })
  await handler.handle(submitted(), sender())
  await handler.handle(submitted(), sender())
  expect(calls.list).toHaveLength(1)
  expect(calls.offers).toHaveLength(1)

  const down = setup({ fail: new TypeError("fetch failed") })
  expect(await down.handler.handle(submitted(), sender())).toEqual({ ok: false, code: "unreachable" })
  await down.handler.handle(submitted(), sender())
  expect(down.calls.list).toHaveLength(2)
  expect(down.calls.offers).toEqual([])
})

test("a site where the offer was turned off is never asked", async () => {
  const { handler, calls } = setup({ jobs: queue, muted: true })
  expect(await handler.handle(submitted(), sender())).toEqual({ ok: true })
  expect(calls.list).toEqual([])
})

test("a wrong sender gets no answer and nothing reaches the api", () => {
  const { handler, calls } = setup({ jobs: queue })
  const bad: FillSender[] = [
    sender({ id: "other" }),
    sender({ tab: { id: 1, active: false } }),
    sender({ url: "chrome-extension://ext/options.html" }),
    sender({ documentLifecycle: "prerender" }),
    sender({ frameId: undefined }),
  ]
  for (const from of bad) expect(handler.handle(submitted(), from)).toBeUndefined()
  expect(handler.handle({ type: "fill-request" }, sender())).toBeUndefined()
  expect(calls.list).toEqual([])
})

test("a site key that is not the sender's site, or a loose message, is invalid", async () => {
  const { handler, calls } = setup({ jobs: queue })
  for (const bad of [submitted({ siteKey: "evil.example.com" }), submitted({ extra: 1 }), submitted({ siteKey: "" })]) {
    expect(await handler.handle(bad, sender())).toEqual({ ok: false, code: "invalid" })
  }
  expect(calls.list).toEqual([])
})

test("a child frame the frame logic does not trust is invalid, a trusted one is matched on the tab url", async () => {
  const untrusted = setup({ jobs: queue, trusted: false })
  expect(
    await untrusted.handler.handle(
      submitted({ siteKey: "boards.example.com" }),
      sender({ frameId: 3, url: "https://boards.example.com/x" }),
    ),
  ).toEqual({ ok: false, code: "invalid" })
  expect(untrusted.calls.list).toEqual([])

  const child = setup({ jobs: queue })
  await child.handler.handle(
    submitted({ siteKey: "boards.example.com" }),
    sender({ frameId: 3, url: "https://boards.example.com/x" }),
  )
  expect(child.calls.offers[0]?.matched?.title).toBe("Engineer 1")
})

test("a tab is limited to a few requests a minute", async () => {
  const { handler, advance } = setup({ jobs: queue })
  const results = []
  for (let i = 0; i < 13; i++) results.push(await handler.handle(submitted(), sender()))
  expect(results[12]).toEqual({ ok: false, code: "busy" })
  advance(61_000)
  expect(await handler.handle(submitted(), sender())).toEqual({ ok: true })
})

const decision = (action: string, offerId = OFFER_ID) => ({ type: "next-decision", offerId, action })

async function offered(options: Parameters<typeof setup>[0] = {}) {
  const made = setup({ jobs: queue, ...options })
  await made.handler.handle(submitted(), sender())
  return made
}

test("open opens the validated link of the offered job once, and marks nothing", async () => {
  const { handler, calls } = await offered()
  expect(await handler.handle(decision("open"), sender())).toEqual({ ok: true })
  expect(calls.opened).toEqual([
    { url: "https://jobs.lever.co/acme/2b1c5f57-0a6d-4c8e-9f1d-3a7e5d9c1b11", windowId: undefined },
  ])
  expect(await handler.handle(decision("open"), sender())).toEqual({ ok: false, code: "invalid" })
  expect(calls.opened).toHaveLength(1)
  expect(calls.create).toEqual([])
})

test("mark records the application for the submitted job only when asked", async () => {
  const { handler, calls } = await offered()
  expect(calls.create).toEqual([])
  expect(await handler.handle(decision("mark"), sender())).toEqual({ ok: true })
  expect(calls.create).toEqual([{ jobId: queue[0]?.id, ats: "greenhouse" }])
  expect(calls.opened).toEqual([])
  expect(await handler.handle(decision("mark"), sender())).toEqual({ ok: false, code: "invalid" })
})

test("a job that already has its application counts as marked", async () => {
  const { handler } = await offered({ markFail: new ORPCError("CONFLICT", { status: 409 }) })
  expect(await handler.handle(decision("mark"), sender())).toEqual({ ok: true })
})

test("an api that is down fails the mark and keeps the offer for another try", async () => {
  const { handler, calls } = await offered({ markFail: new TypeError("fetch failed") })
  expect(await handler.handle(decision("mark"), sender())).toEqual({ ok: false, code: "unreachable" })
  expect(await handler.handle(decision("open"), sender())).toEqual({ ok: true })
  expect(calls.opened).toHaveLength(1)
})

test("nothing to mark for a page that was not in the queue", async () => {
  const { handler, calls } = await offered({ jobs: [queue[1]] })
  expect(await handler.handle(decision("mark"), sender())).toEqual({ ok: false, code: "invalid" })
  expect(calls.create).toEqual([])
})

test("decisions come only from the top frame of the tab, for the offer made", async () => {
  const { handler, calls } = await offered()
  expect(await handler.handle(decision("open"), sender({ frameId: 3 }))).toEqual({ ok: false, code: "invalid" })
  expect(await handler.handle(decision("open", "11111111-1111-4111-8111-111111111111"), sender())).toEqual({
    ok: false,
    code: "invalid",
  })
  expect(await handler.handle(decision("open"), sender({ tab: { id: 2, active: true } }))).toEqual({
    ok: false,
    code: "invalid",
  })
  expect(await handler.handle({ ...decision("open"), url: "https://evil.example" }, sender())).toEqual({
    ok: false,
    code: "invalid",
  })
  expect(calls.opened).toEqual([])
})

test("not now does nothing and ends the offer, don't ask on this site mutes the site", async () => {
  const dismissed = await offered()
  expect(await dismissed.handler.handle(decision("dismiss"), sender())).toEqual({ ok: true })
  expect(await dismissed.handler.handle(decision("open"), sender())).toEqual({ ok: false, code: "invalid" })
  expect(dismissed.calls.opened).toEqual([])
  expect(dismissed.calls.create).toEqual([])
  expect(dismissed.calls.muted).toEqual([])

  const never = await offered()
  expect(await never.handler.handle(decision("never"), sender())).toEqual({ ok: true })
  expect(never.calls.muted).toEqual(["job-boards.greenhouse.io/acme"])
  expect(never.calls.opened).toEqual([])
})

const probe = async (handler: ReturnType<typeof setup>["handler"], from: FillSender = sender()) => {
  expect(handler.handle({ type: "probe-frames" }, from)).toBeUndefined()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

test("an unanswered offer is shown once more on the next top document of the tab, within two minutes", async () => {
  const { handler, calls } = await offered()
  await probe(handler, sender({ frameId: 3 }))
  expect(calls.offers).toHaveLength(1)
  await probe(handler)
  expect(calls.offers).toHaveLength(2)
  await probe(handler)
  expect(calls.offers).toHaveLength(2)

  const late = await offered()
  late.advance(121_000)
  await probe(late.handler)
  expect(late.calls.offers).toHaveLength(1)
})

test("a page on another site never gets the offer, and the offer is over", async () => {
  const { handler, calls } = await offered()
  await probe(handler, sender({ url: "https://careers.other.example/thanks" }))
  expect(calls.offers).toHaveLength(1)
  await probe(handler)
  expect(calls.offers).toHaveLength(1)
  expect(await handler.handle(decision("mark"), sender())).toEqual({ ok: false, code: "invalid" })
  expect(calls.create).toEqual([])
})

test("a decision made on another site than the offer's is refused", async () => {
  const { handler, calls } = await offered()
  const other = sender({ url: "https://careers.other.example/thanks" })
  expect(await handler.handle(decision("mark"), other)).toEqual({ ok: false, code: "invalid" })
  expect(await handler.handle(decision("open"), sender())).toEqual({ ok: false, code: "invalid" })
  expect(calls.create).toEqual([])
  expect(calls.opened).toEqual([])
})

test("a list that comes back after the tab went to another site makes no offer", async () => {
  let release: () => void = () => {}
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })
  let top = PAGE
  const { handler, calls } = setup({ jobs: queue, hold, top: () => top })
  const pending = handler.handle(submitted(), sender())
  top = "https://careers.other.example/thanks"
  release()
  expect(await pending).toEqual({ ok: true })
  expect(calls.offers).toEqual([])
})

test("a dismissed offer is not shown again", async () => {
  const { handler, calls } = await offered()
  await handler.handle(decision("dismiss"), sender())
  await probe(handler)
  expect(calls.offers).toHaveLength(1)
})

test("closing the tab forgets its offer", async () => {
  const { handler, calls } = await offered()
  await handler.forgetTab(1)
  await probe(handler)
  expect(await handler.handle(decision("open"), sender())).toEqual({ ok: false, code: "invalid" })
  expect(calls.offers).toHaveLength(1)
})

test("the job opens in the window of the tab that showed the offer", async () => {
  const { handler, calls } = await offered()
  await handler.handle(decision("open"), sender({ tab: { id: 1, active: true, windowId: 7 } }))
  expect(calls.opened.map((entry) => entry.windowId)).toEqual([7])
})

test("an offer outlives a worker that was stopped: a new worker answers from session storage", async () => {
  const first = await offered()
  const second = setup({ jobs: queue, storage: first.storage })
  expect(await second.handler.handle(decision("mark"), sender())).toEqual({ ok: true })
  expect(second.calls.create).toEqual([{ jobId: queue[0]?.id, ats: "greenhouse" }])
  expect(await second.handler.handle(decision("open"), sender())).toEqual({ ok: true })
  expect(second.calls.opened).toHaveLength(1)
})

test("a page already asked about is not asked again after a worker restart", async () => {
  const first = await offered()
  const second = setup({ jobs: queue, storage: first.storage })
  await second.handler.handle(submitted(), sender())
  expect(second.calls.list).toEqual([])
})

test("an offer nobody answered for ten minutes is gone, even for a new worker", async () => {
  const time = { now: 0 }
  const first = await offered({ time })
  time.now = 601_000
  const second = setup({ jobs: queue, storage: first.storage, time })
  expect(await second.handler.handle(decision("mark"), sender())).toEqual({ ok: false, code: "invalid" })
  expect(second.calls.create).toEqual([])
  const same = await offered({ time })
  time.now += 601_000
  expect(await same.handler.handle(decision("open"), sender())).toEqual({ ok: false, code: "invalid" })
})

test("on a shared host where tenants are paths, another tenant's page never gets the offer", async () => {
  const mine = "https://sites.google.com/view/acme-careers/jobs/1"
  const { handler, calls } = setup({ jobs: [job(1, mine), job(2, "https://example.com/careers/2")], top: () => mine })
  await handler.handle(submitted({ siteKey: "sites.google.com" }), sender({ url: mine }))
  expect(calls.offers[0]?.scope).toBe("sites.google.com/view/acme-careers")
  await probe(handler, sender({ url: "https://sites.google.com/view/other-company/thanks" }))
  expect(calls.offers).toHaveLength(1)
  await probe(handler, sender({ url: mine }))
  expect(calls.offers).toHaveLength(1)
  expect(await handler.handle(decision("mark"), sender({ url: mine }))).toEqual({ ok: false, code: "invalid" })
})

test("the same tenant on a shared host still gets the replay", async () => {
  const mine = "https://sites.google.com/view/acme-careers/jobs/1"
  const { handler, calls } = setup({ jobs: [job(1, mine), job(2, "https://example.com/careers/2")], top: () => mine })
  await handler.handle(submitted({ siteKey: "sites.google.com" }), sender({ url: mine }))
  await probe(handler, sender({ url: "https://sites.google.com/view/acme-careers/thanks" }))
  expect(calls.offers).toHaveLength(2)
})
