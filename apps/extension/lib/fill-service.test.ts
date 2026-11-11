import { describe, expect, spyOn, test } from "bun:test"
import { ORPCError } from "@orpc/client"
import type { FieldMapping } from "@skiffr/common"
import { NotConfiguredError } from "./api"
import { FILL_CONFIDENCE_MIN, FILL_CONFIDENCE_REVIEW, PROFILE_TTL_MS } from "./fill-config"
import { createFillService } from "./fill-service"
import type { FillField, FillRequestMessage } from "./messages"

type Match = {
  fieldId: string
  source: "site" | "exact" | "label" | "similar" | "none"
  value?: string
  autofill?: boolean
}

const PROFILE = {
  id: "p",
  data: { identity: { firstName: "Ana", lastName: "Silva", email: "ana@example.com" }, links: { other: [] } },
  fields: {},
}

function field(id: string, label: string, extra: Partial<FillField> = {}): FillField {
  return { id, label, type: "text", options: [], ...extra }
}

function request(fields: FillField[]): FillRequestMessage {
  return { type: "fill-request", siteKey: "jobs.example.com", fields }
}

function setup(
  opts: {
    matches?: (ids: string[]) => Match[]
    map?: (ids: string[]) => FieldMapping[]
    lookup?: () => Promise<unknown>
    mapFields?: () => Promise<unknown>
    profile?: () => Promise<unknown>
    now?: () => number
  } = {},
) {
  const seen = { lookup: [] as string[][], map: [] as string[][], profile: 0, signals: 0 }
  const client = {
    learning: {
      lookup: async (input: { fields: { id: string }[] }, options?: { signal?: AbortSignal }) => {
        if (options?.signal) seen.signals++
        const ids = input.fields.map((f) => f.id)
        seen.lookup.push(ids)
        if (opts.lookup) return opts.lookup() as never
        return {
          matches: (opts.matches?.(ids) ?? ids.map((fieldId) => ({ fieldId, source: "none" as const }))).map((m) => ({
            answerId: "a",
            score: 1,
            timesUsed: 0,
            timesCorrected: 0,
            value: "",
            autofill: false,
            ...m,
          })),
        }
      },
    },
    ai: {
      mapFields: async (input: { fields: { id: string }[] }, options?: { signal?: AbortSignal }) => {
        if (options?.signal) seen.signals++
        const ids = input.fields.map((f) => f.id)
        seen.map.push(ids)
        if (opts.mapFields) return opts.mapFields() as never
        return { mappings: opts.map?.(ids) ?? [] }
      },
    },
    profile: {
      get: async () => {
        seen.profile++
        return opts.profile ? opts.profile() : PROFILE
      },
    },
  }
  const sleeps: number[] = []
  const service = createFillService({
    call: (run) => run(client as never),
    now: opts.now,
    sleep: async (ms) => void sleeps.push(ms),
  })
  return { service, seen, sleeps }
}

const profileMap = (id: string, key: string, confidence = 0.95): FieldMapping => ({
  id,
  action: "profile",
  key,
  confidence,
  reason: "",
})

describe("merge and precedence", () => {
  test("a saved answer beats the model for the same field, and the model is not asked about it", async () => {
    const { service, seen } = setup({
      matches: () => [{ fieldId: "a", source: "exact", value: "Dr. Ana", autofill: true }],
      map: (ids) => ids.map((id) => profileMap(id, "identity.firstName")),
    })
    const out = await service.run(request([field("a", "First name"), field("b", "Given name")]))
    expect(seen.map).toEqual([["b"]])
    if (!out.ok) throw new Error("expected ok")
    expect(out.mapping.find((m) => m.id === "a")).toMatchObject({ action: "generate", value: "Dr. Ana", confidence: 1 })
    expect(out.mapping.find((m) => m.id === "b")).toMatchObject({ action: "profile", key: "identity.firstName" })
    expect(out.summary).toMatchObject({ exact: 1, profile: 1 })
    expect(out.values).toEqual({ "identity.firstName": "Ana" })
  })

  test("a site entry fills at full confidence and the model is not asked about that field", async () => {
    const { service, seen } = setup({
      matches: () => [{ fieldId: "a", source: "site", value: "Lisbon", autofill: true }],
      map: (ids) => ids.map((id) => profileMap(id, "identity.firstName")),
    })
    const out = await service.run(request([field("a", "City"), field("b", "Name")]))
    if (!out.ok) throw new Error("expected ok")
    expect(seen.map).toEqual([["b"]])
    expect(out.mapping.find((m) => m.id === "a")).toMatchObject({ action: "generate", value: "Lisbon", confidence: 1 })
    expect(out.summary).toMatchObject({ site: 1, exact: 0, label: 0, profile: 1 })
  })

  test("a site entry beats what the model would give for the same field, and the same field's label match", async () => {
    const { service } = setup({
      // the server ranks site first: it is the only candidate it returns for the field
      matches: () => [{ fieldId: "a", source: "site", value: "From site", autofill: true }],
      map: () => [{ id: "a", action: "generate", value: "From model", confidence: 0.99, reason: "" }],
    })
    const out = await service.run(request([field("a", "Why us?")]))
    if (!out.ok) throw new Error("expected ok")
    expect(out.mapping).toHaveLength(1)
    expect(out.mapping[0]).toMatchObject({ value: "From site" })
  })

  test("a site entry that must not autofill is a suggestion, not applied", async () => {
    const { service } = setup({
      matches: () => [{ fieldId: "a", source: "site", value: "Old answer", autofill: false }],
    })
    const out = await service.run(request([field("a", "City")]))
    if (!out.ok) throw new Error("expected ok")
    expect(out.mapping).toEqual([])
    expect(out.suggestions).toEqual(["a"])
    expect(out.summary).toMatchObject({ site: 0, suggested: 1 })
  })

  test("label matches rank below exact ones but still fill", async () => {
    const { service } = setup({ matches: () => [{ fieldId: "a", source: "label", value: "Lisbon", autofill: true }] })
    const out = await service.run(request([field("a", "City")]))
    if (!out.ok) throw new Error("expected ok")
    expect(out.mapping[0]).toMatchObject({ value: "Lisbon", confidence: 0.9 })
    expect(out.summary.label).toBe(1)
  })

  test("a similar-question answer is a suggestion and never fills", async () => {
    const { service } = setup({
      matches: () => [{ fieldId: "a", source: "similar", value: "Remote only", autofill: false }],
    })
    const out = await service.run(request([field("a", "Where do you want to work?")]))
    if (!out.ok) throw new Error("expected ok")
    expect(out.mapping).toEqual([])
    expect(out.suggestions).toEqual(["a"])
    expect(out.summary.suggested).toBe(1)
  })

  test("a similar match marked autofill by mistake still does not fill", async () => {
    const { service } = setup({ matches: () => [{ fieldId: "a", source: "similar", value: "x", autofill: true }] })
    const out = await service.run(request([field("a", "Q")]))
    if (!out.ok) throw new Error("expected ok")
    expect(out.mapping).toEqual([])
    expect(out.suggestions).toEqual(["a"])
  })

  test("a long saved value stays a suggestion", async () => {
    const { service } = setup({
      matches: () => [{ fieldId: "a", source: "exact", value: "x".repeat(400), autofill: true }],
    })
    const out = await service.run(request([field("a", "Why us?")]))
    if (!out.ok) throw new Error("expected ok")
    expect(out.mapping).toEqual([])
    expect(out.suggestions).toEqual(["a"])
  })

  test("when the model fills a field that also has a suggestion, it is no longer a suggestion", async () => {
    const { service } = setup({
      matches: () => [{ fieldId: "a", source: "similar", value: "x", autofill: false }],
      map: () => [profileMap("a", "identity.email")],
    })
    const out = await service.run(request([field("a", "Contact")]))
    if (!out.ok) throw new Error("expected ok")
    expect(out.suggestions).toEqual([])
    expect(out.mapping).toHaveLength(1)
  })
})

describe("confidence thresholds", () => {
  test("fills from the review level up, keeps the band below as low confidence, drops under the minimum", async () => {
    const { service } = setup({
      map: () => [
        profileMap("hi", "identity.firstName", FILL_CONFIDENCE_REVIEW),
        profileMap("mid", "identity.lastName", FILL_CONFIDENCE_MIN),
        profileMap("low", "identity.email", FILL_CONFIDENCE_MIN - 0.01),
        { id: "gen", action: "generate", value: "Yes", confidence: 0.5, reason: "" },
        { id: "skip", action: "skip", confidence: 1, reason: "" },
      ],
    })
    const out = await service.run(
      request([field("hi", "a"), field("mid", "b"), field("low", "c"), field("gen", "d"), field("skip", "e")]),
    )
    if (!out.ok) throw new Error("expected ok")
    expect(out.mapping.map((m) => m.id)).toEqual(["hi", "mid", "gen"])
    expect(out.summary).toMatchObject({ profile: 2, generated: 1, review: 2, skipped: 2 })
    expect(out.values).toEqual({ "identity.firstName": "Ana", "identity.lastName": "Silva" })
  })

  test("a profile key the profile does not hold is dropped, not filled empty", async () => {
    const { service } = setup({ map: () => [profileMap("a", "links.github")] })
    const out = await service.run(request([field("a", "GitHub")]))
    if (!out.ok) throw new Error("expected ok")
    expect(out.mapping).toEqual([])
  })
})

describe("what is sent", () => {
  test("password, hidden, file and card fields never leave the worker", async () => {
    const { service, seen } = setup()
    await service.run(
      request([
        field("pw", "Password", { type: "password" }),
        field("h", "Token", { type: " Hidden " }),
        field("f", "Resume", { type: "file" }),
        field("cc", "Card", { autocomplete: "cc-number" }),
        field("ok", "Name"),
      ]),
    )
    expect(seen.lookup).toEqual([["ok"]])
    expect(seen.map).toEqual([["ok"]])
  })

  test("a field without a label skips the lookup but still reaches the model", async () => {
    const { service, seen } = setup()
    await service.run(request([field("a", ""), field("b", "Name")]))
    expect(seen.lookup).toEqual([["b"]])
    expect(seen.map).toEqual([["a", "b"]])
  })

  test("every api call carries an abort signal", async () => {
    const { service, seen } = setup({ map: (ids) => ids.map((id) => profileMap(id, "identity.firstName")) })
    await service.run(request([field("a", "Name")]))
    expect(seen.signals).toBe(2)
  })

  test("more than 60 fields are split into several lookups and mapFields calls", async () => {
    const { service, seen } = setup({ map: (ids) => ids.map((id) => profileMap(id, "identity.firstName")) })
    const many = Array.from({ length: 130 }, (_, i) => field(`f${i}`, `Question ${i}`))
    const out = await service.run(request(many))
    expect(seen.lookup.map((batch) => batch.length)).toEqual([60, 60, 10])
    expect(seen.map.map((batch) => batch.length)).toEqual([60, 60, 10])
    if (!out.ok) throw new Error("expected ok")
    expect(out.mapping).toHaveLength(130)
    expect(seen.profile).toBe(1)
  })
})

describe("profile cache", () => {
  test("is read once inside the ttl, again after it, and never for a request that needs no profile", async () => {
    let time = 1_000
    const { service, seen } = setup({
      now: () => time,
      map: (ids) => ids.map((id) => profileMap(id, "identity.firstName")),
    })
    await service.run(request([field("a", "Name")]))
    time += PROFILE_TTL_MS - 1
    await service.run(request([field("a", "Name")]))
    expect(seen.profile).toBe(1)
    time += 2
    await service.run(request([field("a", "Name")]))
    expect(seen.profile).toBe(2)
    service.clear()
    await service.run(request([field("a", "Name")]))
    expect(seen.profile).toBe(3)
  })

  test("two requests at once share one profile read", async () => {
    const { service, seen } = setup({ map: (ids) => ids.map((id) => profileMap(id, "identity.firstName")) })
    await Promise.all([service.run(request([field("a", "Name")])), service.run(request([field("b", "Other")]))])
    expect(seen.profile).toBe(1)
  })
})

describe("failures", () => {
  const unavailable = () => Promise.reject(new ORPCError("SERVICE_UNAVAILABLE"))

  test("lookup works and the model fails: what the lookup found is still filled and the problem is reported", async () => {
    const { service } = setup({
      matches: () => [{ fieldId: "a", source: "exact", value: "Ana", autofill: true }],
      mapFields: unavailable,
    })
    const out = await service.run(request([field("a", "First name"), field("b", "Other")]))
    if (!out.ok) throw new Error("expected ok")
    expect(out.mapping).toHaveLength(1)
    expect(out.summary.problem).toBe("unavailable")
  })

  test("the lookup fails and the model works: the model still fills", async () => {
    const { service } = setup({
      lookup: unavailable,
      map: (ids) => ids.map((id) => profileMap(id, "identity.firstName")),
    })
    const out = await service.run(request([field("a", "Name")]))
    if (!out.ok) throw new Error("expected ok")
    expect(out.mapping).toHaveLength(1)
    expect(out.summary.problem).toBe("unavailable")
  })

  test("nothing to show and a failure is an error", async () => {
    const { service } = setup({ lookup: unavailable, mapFields: unavailable })
    expect(await service.run(request([field("a", "Name")]))).toEqual({ ok: false, code: "unavailable" })
  })

  test("a rejected token stops everything and says so", async () => {
    const { service, seen } = setup({ lookup: () => Promise.reject(new ORPCError("UNAUTHORIZED")) })
    expect(await service.run(request([field("a", "Name")]))).toEqual({ ok: false, code: "rejected" })
    expect(seen.map).toEqual([])
  })

  test("a token revoked after the lookup still fills the saved answer and points at the settings", async () => {
    const { service } = setup({
      matches: () => [{ fieldId: "a", source: "exact", value: "Ana", autofill: true }],
      mapFields: () => Promise.reject(new ORPCError("UNAUTHORIZED")),
    })
    const out = await service.run(request([field("a", "x"), field("b", "y")]))
    if (!out.ok) throw new Error("expected ok")
    expect(out.mapping).toHaveLength(1)
    expect(out.summary.problem).toBe("rejected")
  })

  test("a site answer and a failing model still fills the site answer (every tier counts)", async () => {
    for (const source of ["site", "exact", "label"] as const) {
      const { service } = setup({
        matches: () => [{ fieldId: "a", source, value: "Ana", autofill: true }],
        mapFields: unavailable,
      })
      const out = await service.run(request([field("a", "First name"), field("b", "Other")]))
      if (!out.ok) throw new Error(`expected ok for ${source}`)
      expect(out.mapping).toHaveLength(1)
      expect(out.summary).toMatchObject({ [source]: 1, problem: "unavailable" })
    }
  })

  test("the paid model call is never repeated after a timeout or a 5xx, only when it never reached the server", async () => {
    const calls = { timeout: 0, http: 0, offline: 0 }
    const run = async (kind: keyof typeof calls, error: unknown) => {
      const { service } = setup({
        matches: () => [{ fieldId: "a", source: "site", value: "Ana", autofill: true }],
        mapFields: () => {
          calls[kind]++
          return Promise.reject(error)
        },
      })
      await service.run(request([field("a", "x"), field("b", "y")]))
    }
    await run("timeout", new DOMException("t", "TimeoutError"))
    await run("http", new ORPCError("SERVICE_UNAVAILABLE"))
    await run("offline", new TypeError("Failed to fetch"))
    expect(calls).toEqual({ timeout: 1, http: 1, offline: 2 })
  })

  test("a lookup that timed out or could not connect stops the fill: the model call would fail the same way", async () => {
    for (const error of [new DOMException("t", "TimeoutError"), new TypeError("Failed to fetch")]) {
      const { service, seen } = setup({ lookup: () => Promise.reject(error) })
      const out = await service.run(request([field("a", "Name")]))
      expect(out.ok).toBe(false)
      expect(seen.map).toEqual([])
    }
  })

  test("no token configured", async () => {
    const service = createFillService({ call: () => Promise.reject(new NotConfiguredError()) })
    expect(await service.run(request([field("a", "Name")]))).toEqual({ ok: false, code: "not-configured" })
  })

  test("a missing profile is its own error", async () => {
    const { service } = setup({
      map: (ids) => ids.map((id) => profileMap(id, "identity.firstName")),
      profile: async () => null,
    })
    expect(await service.run(request([field("a", "Name")]))).toEqual({ ok: false, code: "no-profile" })
  })

  test("a 503 is retried once after a pause, then it works", async () => {
    let tries = 0
    const { service, sleeps } = setup({
      lookup: () =>
        ++tries === 1
          ? Promise.reject(new ORPCError("SERVICE_UNAVAILABLE"))
          : Promise.resolve({
              matches: [{ fieldId: "a", source: "exact", value: "Ana", autofill: true, answerId: "x" }],
            }),
    })
    const out = await service.run(request([field("a", "Name")]))
    expect(tries).toBe(2)
    expect(sleeps).toHaveLength(1)
    expect(out.ok && out.summary.exact).toBe(1)
  })

  test("a 503 twice gives up after one retry", async () => {
    let tries = 0
    const { service } = setup({
      lookup: () => {
        tries++
        return Promise.reject(new ORPCError("SERVICE_UNAVAILABLE"))
      },
      mapFields: unavailable,
    })
    await service.run(request([field("a", "Name")]))
    expect(tries).toBe(2)
  })

  test("a rejected token is not retried", async () => {
    let tries = 0
    const { service } = setup({
      lookup: () => {
        tries++
        return Promise.reject(new ORPCError("UNAUTHORIZED"))
      },
    })
    await service.run(request([field("a", "Name")]))
    expect(tries).toBe(1)
  })

  test("a network failure is unreachable and a timeout is a timeout", async () => {
    const offline = setup({
      lookup: () => Promise.reject(new TypeError("Failed to fetch")),
      mapFields: () => Promise.reject(new TypeError("Failed to fetch")),
    })
    expect(await offline.service.run(request([field("a", "Name")]))).toEqual({ ok: false, code: "unreachable" })
    const slow = setup({
      lookup: () => Promise.reject(new DOMException("timed out", "TimeoutError")),
      mapFields: () => Promise.reject(new DOMException("timed out", "TimeoutError")),
    })
    expect(await slow.service.run(request([field("a", "Name")]))).toEqual({ ok: false, code: "timeout" })
  })

  test("a call that never answers is cut off by its signal", async () => {
    const service = createFillService({
      call: (run) =>
        run({
          learning: {
            lookup: (_input: unknown, options: { signal: AbortSignal }) =>
              new Promise((_, reject) => {
                if (options.signal.aborted) reject(options.signal.reason)
                else options.signal.addEventListener("abort", () => reject(options.signal.reason))
              }),
          },
          ai: { mapFields: () => Promise.reject(new TypeError("x")) },
        } as never),
      sleep: async () => {},
    })
    // timeouts are real (8s) in production; here the signal is replaced so the test stays fast
    const original = AbortSignal.timeout
    AbortSignal.timeout = () => AbortSignal.abort(new DOMException("t", "TimeoutError"))
    try {
      expect(await service.run(request([field("a", "Name")]))).toEqual({ ok: false, code: "timeout" })
    } finally {
      AbortSignal.timeout = original
    }
  })
})

test("no field text, value or error text reaches the console", async () => {
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => spyOn(console, level))
  const { service } = setup({
    matches: () => [{ fieldId: "a", source: "exact", value: "secret-value", autofill: true }],
    mapFields: () => Promise.reject(new ORPCError("SERVICE_UNAVAILABLE", { message: "secret-label leaked" })),
  })
  await service.run(request([field("a", "secret-label"), field("b", "secret-label-2")]))
  for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  for (const spy of spies) spy.mockRestore()
})

describe("settings change, deadline and cancel", () => {
  test("a profile read that was in flight when the settings changed is dropped, and the next fill reads the new one", async () => {
    let release: (value: unknown) => void = () => {}
    let reads = 0
    const { service } = setup({
      map: (ids) => ids.map((id) => profileMap(id, "identity.firstName")),
      profile: () => {
        reads++
        if (reads === 1) return new Promise((resolve) => (release = resolve))
        return Promise.resolve({ ...PROFILE, data: { ...PROFILE.data, identity: { firstName: "Bea" } } })
      },
    })
    const first = service.run(request([field("a", "Name")]))
    await new Promise((resolve) => setTimeout(resolve, 5))
    service.clear()
    release(PROFILE)
    expect(await first).toEqual({ ok: false, code: "changed" })
    const second = await service.run(request([field("a", "Name")]))
    if (!second.ok) throw new Error("expected ok")
    expect(second.values).toEqual({ "identity.firstName": "Bea" })
  })

  test("a model value is always for review, whatever its confidence", async () => {
    const { service } = setup({
      map: () => [{ id: "a", action: "generate", value: "No", confidence: 0.99, reason: "" }],
    })
    const out = await service.run(request([field("a", "Do you need sponsorship?")]))
    if (!out.ok) throw new Error("expected ok")
    expect(out.mapping[0]?.confidence).toBeLessThan(FILL_CONFIDENCE_REVIEW)
    expect(out.summary).toMatchObject({ generated: 1, review: 1 })
  })

  test("a profile key that is an object property name is not a profile key", async () => {
    const { service } = setup({ map: () => [profileMap("a", "constructor"), profileMap("b", "toString")] })
    const out = await service.run(request([field("a", "x"), field("b", "y")]))
    if (!out.ok) throw new Error("expected ok")
    expect(out.mapping).toEqual([])
  })

  test("one deadline covers every batch: what finished is kept, the rest is reported", async () => {
    let time = 0
    const { service, seen } = setup({
      now: () => time,
      map: (ids) => {
        time += 30_000
        return ids.map((id) => profileMap(id, "identity.firstName"))
      },
    })
    const many = Array.from({ length: 130 }, (_, i) => field(`f${i}`, `Question ${i}`))
    const out = await service.run(request(many))
    if (!out.ok) throw new Error("expected ok")
    expect(seen.map).toHaveLength(2)
    expect(out.mapping).toHaveLength(120)
    expect(out.summary.problem).toBe("timeout")
  })

  test("a request whose tab is gone stops before it calls the api", async () => {
    const { service, seen } = setup()
    const stop = new AbortController()
    stop.abort()
    expect((await service.run(request([field("a", "Name")]), stop.signal)).ok).toBe(false)
    expect(seen.lookup).toEqual([])
  })
})

describe("the profile read", () => {
  test("is not made when no model answer wants a profile value", async () => {
    const { service, seen } = setup({
      matches: () => [{ fieldId: "a", source: "site", value: "Ana", autofill: true }],
      map: () => [{ id: "b", action: "generate", value: "No", confidence: 0.9, reason: "" }],
    })
    await service.run(request([field("a", "x"), field("b", "y")]))
    expect(seen.profile).toBe(0)
  })

  test("a tab that closes while waiting does not cancel the read the other tab waits on", async () => {
    let release: (value: unknown) => void = () => {}
    const { service, seen } = setup({
      map: (ids) => ids.map((id) => profileMap(id, "identity.firstName")),
      profile: () => new Promise((resolve) => (release = resolve)),
    })
    const closing = new AbortController()
    const first = service.run(request([field("a", "Name")]), closing.signal)
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = service.run(request([field("b", "Other")]))
    await new Promise((resolve) => setTimeout(resolve, 5))
    closing.abort()
    release(PROFILE)
    expect((await first).ok).toBe(false)
    const out = await second
    if (!out.ok) throw new Error("expected ok")
    expect(out.values).toEqual({ "identity.firstName": "Ana" })
    expect(seen.profile).toBe(1)
  })
})
