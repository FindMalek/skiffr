import { afterEach, expect, spyOn, test } from "bun:test"
import { Window } from "happy-dom"
import { createWorkerProvider } from "./fill-client"
import { FILL_CONFIDENCE_REVIEW } from "./fill-config"
import { handleFill, setMappingProvider } from "./fill-handler"
import { createFillRequestHandler } from "./fill-request"
import { createFillService } from "./fill-service"
import type { FillRequestMessage } from "./messages"

afterEach(() => setMappingProvider(null))

function page(html = `<label>First name <input name="first_name"></label>`) {
  const window = new Window({ url: "https://careers.example/apply" })
  window.document.write(`<form id="f">${html}<button type="submit">Apply</button></form>`)
  let submitted = false
  window.document.getElementById("f")?.addEventListener("submit", () => {
    submitted = true
  })
  return { doc: window.document as unknown as Document, submitted: () => submitted }
}

const input = (doc: Document, name: string) => doc.querySelector(`[name=${name}]`) as HTMLInputElement

test("without a mapping provider nothing is filled and it says why", async () => {
  const { doc } = page()
  expect(await handleFill(doc)).toEqual({ ok: false, code: "failed", reason: "no mapping provider" })
  expect(input(doc, "first_name").value).toBe("")
})

test("an injected provider fills the page and never submits it", async () => {
  const { doc, submitted } = page()
  setMappingProvider(async (fields) => ({
    mapping: fields.map((field) => ({ id: field.id, action: "profile", key: "first", confidence: 0.9, reason: "" })),
    values: { first: "Ada" },
  }))
  const outcome = await handleFill(doc)
  expect(outcome.ok && outcome.summary.counts.filled).toBe(1)
  expect(input(doc, "first_name").value).toBe("Ada")
  expect(submitted()).toBe(false)
})

test("a provider that throws is reported, not thrown", async () => {
  setMappingProvider(async () => {
    throw new Error("api down")
  })
  expect(await handleFill(page().doc)).toEqual({ ok: false, code: "failed", reason: "api down" })
})

const PROFILE = {
  id: "p",
  data: { identity: { firstName: "Ana", lastName: "Silva" }, links: { other: [] } },
  fields: {},
}

/** The real worker side (request handler and fill service) behind a fake api, reached the way a content script reaches it. */
function fakeWorker(opts: {
  mappings?: (ids: string[]) => unknown[]
  matches?: (ids: string[]) => unknown[]
  fail?: Error
}) {
  const sent: FillRequestMessage[] = []
  const service = createFillService({
    call: async (run) =>
      run({
        learning: {
          lookup: async (i: { fields: { id: string }[] }) => {
            if (opts.fail) throw opts.fail
            const ids = i.fields.map((f) => f.id)
            return { matches: opts.matches?.(ids) ?? ids.map((fieldId) => ({ fieldId, source: "none" })) }
          },
        },
        ai: {
          mapFields: async (i: { fields: { id: string }[] }) => {
            if (opts.fail) throw opts.fail
            return { mappings: opts.mappings?.(i.fields.map((f) => f.id)) ?? [] }
          },
        },
        profile: { get: async () => PROFILE },
      } as never),
    sleep: async () => {},
  })
  const handler = createFillRequestHandler({
    extensionId: "ext",
    extensionUrl: "chrome-extension://ext/",
    service,
    isTrustedFrame: async () => true,
  })
  const send = async (message: FillRequestMessage) => {
    sent.push(structuredClone(message))
    return handler.handle(message, {
      id: "ext",
      url: "https://careers.example/apply",
      frameId: 0,
      tab: { id: 1, active: true },
    })
  }
  return { send, sent }
}

test("round trip: the worker fills from a saved answer and the profile, outlines low confidence, never fills a suggestion", async () => {
  const { doc, submitted } = page(`
    <label>First name <input name="first_name"></label>
    <label>Last name <input name="last_name"></label>
    <label>Preferred pronouns <input name="pronouns"></label>
    <label>Where would you like to work? <input name="where"></label>
    <label>Email <input name="email" value="typed@by.me"></label>
    <label>Password <input type="password" name="pw"></label>
    <label>CV <input type="file" name="cv"></label>`)
  const { send, sent } = fakeWorker({
    matches: (ids) =>
      ids.map((fieldId, i) =>
        i === 2
          ? { fieldId, source: "exact", value: "she/her", autofill: true, answerId: "a" }
          : i === 3
            ? { fieldId, source: "similar", value: "Remote", autofill: false, answerId: "b" }
            : { fieldId, source: "none" },
      ),
    mappings: (ids) => [
      { id: ids[0], action: "profile", key: "identity.firstName", confidence: 0.95, reason: "" },
      { id: ids[1], action: "profile", key: "identity.lastName", confidence: 0.5, reason: "" },
    ],
  })
  setMappingProvider(createWorkerProvider(send, () => "https://careers.example/apply"))

  const outcome = await handleFill(doc)

  expect(outcome.ok && [outcome.filled, outcome.review, outcome.suggested]).toEqual([3, 1, 1])
  expect(input(doc, "first_name").value).toBe("Ana")
  expect(input(doc, "last_name").value).toBe("Silva")
  expect(input(doc, "pronouns").value).toBe("she/her")
  expect(input(doc, "where").value).toBe("")
  expect(input(doc, "email").value).toBe("typed@by.me")
  expect(input(doc, "last_name").style.getPropertyValue("outline")).toContain("solid")
  expect(input(doc, "first_name").style.getPropertyValue("outline")).toBe("")
  expect(input(doc, "where").style.getPropertyValue("outline")).toContain("solid")
  expect(submitted()).toBe(false)

  const request = JSON.stringify(sent)
  expect(sent).toHaveLength(1)
  expect(sent[0]?.siteKey).toBe("careers.example")
  expect(sent[0]?.fields.map((f) => f.label)).toEqual([
    "First name",
    "Last name",
    "Preferred pronouns",
    "Where would you like to work?",
  ])
  for (const never of ["typed@by.me", "Password", "CV", "file", "password"]) expect(request).not.toContain(never)
  expect(FILL_CONFIDENCE_REVIEW).toBe(0.7)
})

test("a second fill clears the outlines the first one left", async () => {
  const { doc } = page(`<label>Last name <input name="last_name"></label>`)
  const { send } = fakeWorker({
    mappings: (ids) => [{ id: ids[0], action: "profile", key: "identity.lastName", confidence: 0.5, reason: "" }],
  })
  setMappingProvider(createWorkerProvider(send, () => "https://careers.example/apply"))
  await handleFill(doc)
  expect(input(doc, "last_name").style.getPropertyValue("outline")).toContain("solid")
  input(doc, "last_name").value = ""
  setMappingProvider(async () => ({ mapping: [], values: {} }))
  await handleFill(doc)
  expect(input(doc, "last_name").style.getPropertyValue("outline")).toBe("")
})

test("a page with nothing to ask about makes no request", async () => {
  const { doc } = page(`<input type="password" name="pw"><label>Name <input name="n" value="already"></label>`)
  const { send, sent } = fakeWorker({})
  setMappingProvider(createWorkerProvider(send, () => "https://careers.example/apply"))
  const outcome = await handleFill(doc)
  expect(sent).toEqual([])
  expect(outcome.ok && [outcome.filled, outcome.review]).toEqual([0, 0])
})

test("failures reach the page as a code it can explain", async () => {
  const { doc } = page()
  const url = () => "https://careers.example/apply"

  const { ORPCError } = await import("@orpc/client")
  const rejected = fakeWorker({ fail: new ORPCError("UNAUTHORIZED") })
  setMappingProvider(createWorkerProvider(rejected.send, url))
  expect(await handleFill(doc)).toMatchObject({ ok: false, code: "rejected" })

  setMappingProvider(createWorkerProvider(async () => undefined, url))
  expect(await handleFill(doc)).toMatchObject({ ok: false, code: "failed" })

  setMappingProvider(createWorkerProvider(async () => Promise.reject(new Error("worker gone")), url))
  expect(await handleFill(doc)).toMatchObject({ ok: false, code: "failed" })

  setMappingProvider(createWorkerProvider(() => new Promise(() => {}), url, 10))
  expect(await handleFill(doc)).toMatchObject({ ok: false, code: "timeout" })

  setMappingProvider(createWorkerProvider(async () => ({ ok: false, code: "busy" }), url))
  expect(await handleFill(doc)).toMatchObject({ ok: false, code: "busy" })

  setMappingProvider(createWorkerProvider(async () => ({ ok: true, mapping: "nope" }), url))
  expect(await handleFill(doc)).toMatchObject({ ok: false, code: "failed" })
})

test("a page without a site key is not asked about", async () => {
  const { send, sent } = fakeWorker({})
  setMappingProvider(createWorkerProvider(send, () => "about:blank"))
  expect(await handleFill(page().doc)).toMatchObject({ ok: false, code: "invalid" })
  expect(sent).toEqual([])
})

test("labels and values stay out of the console", async () => {
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => spyOn(console, level))
  const { doc } = page(`<label>Secret label <input name="s"></label>`)
  const { send } = fakeWorker({
    mappings: (ids) => [{ id: ids[0], action: "generate", value: "secret-value", confidence: 0.9, reason: "" }],
  })
  setMappingProvider(createWorkerProvider(send, () => "https://careers.example/apply"))
  await handleFill(doc)
  setMappingProvider(
    createWorkerProvider(
      async () => Promise.reject(new Error("secret label")),
      () => "https://careers.example/apply",
    ),
  )
  await handleFill(page(`<label>Secret label <input name="s"></label>`).doc)
  for (const spy of spies) {
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  }
})

const SITE = () => "https://careers.example/apply"

function sink() {
  const sent: FillRequestMessage[] = []
  const send = async (message: FillRequestMessage) => {
    sent.push(structuredClone(message))
    return {
      ok: true,
      mapping: message.fields.map((f) => ({
        id: f.id,
        action: "generate",
        value: "x",
        confidence: 0.9,
        reason: "",
      })),
      values: {},
      suggestions: [],
      summary: { site: 0, exact: 0, label: 0, profile: 0, generated: 0, review: 0, suggested: 0, skipped: 0 },
    }
  }
  return { sent, send }
}

test("only the detected application form is asked about: a search box and a newsletter box stay out", async () => {
  const window = new Window({ url: "https://careers.example/apply" })
  window.document.title = "Apply for Senior Engineer"
  window.document.write(`
    <form role="search" action="/s"><input type="search" name="q" aria-label="Search jobs"></form>
    <form id="news" action="/newsletter"><label>Newsletter email <input type="email" name="nl"></label><button>Subscribe</button></form>
    <form id="app">
      <label>First name <input name="first_name"></label>
      <label>Last name <input name="last_name"></label>
      <label>Email <input type="email" name="email"></label>
      <button type="submit">Submit application</button>
    </form>`)
  const doc = window.document as unknown as Document
  const { sent, send } = sink()
  setMappingProvider(createWorkerProvider(send, SITE))
  const outcome = await handleFill(doc)
  expect(sent[0]?.fields.map((f) => f.label)).toEqual(["First name", "Last name", "Email"])
  expect(outcome.ok && outcome.filled).toBe(3)
  expect(input(doc, "nl").value).toBe("")
  expect(input(doc, "q").value).toBe("")
})

test("a page with no detectable form still never asks about search boxes or newsletter forms", async () => {
  const { doc } = page(`
    <input type="search" name="q" aria-label="Search">
    <form id="news" action="/newsletter"><label>Email <input type="email" name="nl"></label></form>`)
  const { sent, send } = sink()
  setMappingProvider(createWorkerProvider(send, SITE))
  await handleFill(doc)
  expect(sent).toEqual([])
})

test("a form the page swapped out during the request counts as not filled", async () => {
  const { doc } = page(
    `<label>First name <input name="first_name"></label><label>Last name <input name="last_name"></label>`,
  )
  setMappingProvider(async (fields) => {
    for (const field of fields) field.el.remove()
    return {
      mapping: fields.map((f) => ({
        id: f.id,
        action: "generate" as const,
        value: "Ana",
        confidence: 0.9,
        reason: "",
      })),
      values: {},
    }
  })
  expect(await handleFill(doc)).toMatchObject({ ok: false, code: "changed" })
})

test("an element that left the page while the others were filled is not counted", async () => {
  const { doc } = page(
    `<label>First name <input name="first_name"></label><label>Last name <input name="last_name"></label>`,
  )
  setMappingProvider(async (fields) => {
    fields[1]?.el.remove()
    return {
      mapping: fields.map((f) => ({
        id: f.id,
        action: "generate" as const,
        value: "Ana",
        confidence: 0.9,
        reason: "",
      })),
      values: {},
    }
  })
  const outcome = await handleFill(doc)
  expect(outcome.ok && outcome.filled).toBe(1)
})

test("the page navigating during the request makes the answer void", async () => {
  const { doc } = page()
  setMappingProvider(async (fields) => {
    ;(doc.defaultView as unknown as { happyDOM: { setURL: (url: string) => void } }).happyDOM.setURL(
      "https://careers.example/other",
    )
    return {
      mapping: fields.map((f) => ({
        id: f.id,
        action: "generate" as const,
        value: "Ana",
        confidence: 0.9,
        reason: "",
      })),
      values: {},
    }
  })
  expect(await handleFill(doc)).toMatchObject({ ok: false, code: "changed" })
  expect(input(doc, "first_name").value).toBe("")
})

test("outlined fields say why to assistive technology and lose it with the outline", async () => {
  const { doc } = page(`<label>Last name <input name="last_name"></label><label>Where <input name="where"></label>`)
  setMappingProvider(async (fields) => ({
    mapping: [{ id: fields[0]?.id as string, action: "generate", value: "Silva", confidence: 0.5, reason: "" }],
    values: {},
    suggestions: [fields[1]?.id as string],
  }))
  const outcome = await handleFill(doc)
  expect(input(doc, "last_name").getAttribute("aria-description")).toContain("check")
  expect(input(doc, "where").getAttribute("aria-description")).toContain("suggestion")
  expect(input(doc, "last_name").style.getPropertyValue("box-shadow")).toContain("#fbbf24")
  if (outcome.ok) outcome.summary.clearHighlights()
  expect(input(doc, "last_name").hasAttribute("aria-description")).toBe(false)
})
