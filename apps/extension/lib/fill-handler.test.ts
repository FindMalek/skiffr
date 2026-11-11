import { afterEach, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { handleFill, setMappingProvider } from "./fill-handler"

afterEach(() => setMappingProvider(null))

function page() {
  const window = new Window({ url: "https://careers.example/apply" })
  window.document.write(
    `<form id="f"><label>First name <input name="first_name"></label><button type="submit">Apply</button></form>`,
  )
  let submitted = false
  window.document.getElementById("f")?.addEventListener("submit", () => {
    submitted = true
  })
  return { doc: window.document as unknown as Document, submitted: () => submitted }
}

test("without a mapping provider nothing is filled and it says why", async () => {
  const { doc } = page()
  expect(await handleFill(doc)).toEqual({ ok: false, reason: "no mapping provider" })
  expect((doc.querySelector("input") as HTMLInputElement).value).toBe("")
})

test("an injected provider fills the page and never submits it", async () => {
  const { doc, submitted } = page()
  setMappingProvider(async (fields) => ({
    mapping: fields.map((field) => ({ id: field.id, action: "profile", key: "first", confidence: 0.9, reason: "" })),
    values: { first: "Ada" },
  }))
  const outcome = await handleFill(doc)
  expect(outcome.ok && outcome.summary.counts.filled).toBe(1)
  expect((doc.querySelector("input") as HTMLInputElement).value).toBe("Ada")
  expect(submitted()).toBe(false)
})

test("a provider that throws is reported, not thrown", async () => {
  setMappingProvider(async () => {
    throw new Error("api down")
  })
  expect(await handleFill(page().doc)).toEqual({ ok: false, reason: "api down" })
})
