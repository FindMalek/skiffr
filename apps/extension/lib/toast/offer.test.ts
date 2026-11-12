import { expect, test } from "bun:test"
import { offerMessage } from "./offer"

/** The isolates keep a title in another script in order inside the sentence and show nothing. */
const plain = (text: string | undefined): string | undefined => text?.replace(/[\u2068\u2069]/g, "")

const matched = { title: "Backend Engineer", company: "Acme" }
const next = { title: "Staff Engineer", company: "Globex" }

test("both parts are offered with the not now and don't ask choices", () => {
  const message = offerMessage({ matched, next })
  expect(plain(message?.text)).toBe("Submitted Backend Engineer at Acme? Next in your queue: Staff Engineer at Globex.")
  expect(message?.actions).toEqual(["open-next", "mark-applied", "not-now", "stop-next"])
  expect(message?.size).toBe("offer")
  expect(offerMessage({ matched: null, next: null }, "marked")?.size).toBeUndefined()
})

test("a page outside the queue only offers the next job", () => {
  const message = offerMessage({ matched: null, next })
  expect(plain(message?.text)).toBe("Next in your queue: Staff Engineer at Globex.")
  expect(message?.actions).toEqual(["open-next", "not-now", "stop-next"])
})

test("with nothing else queued only marking is offered", () => {
  const message = offerMessage({ matched, next: null })
  expect(plain(message?.text)).toBe("Submitted Backend Engineer at Acme? Your queue has nothing else.")
  expect(message?.actions).toEqual(["mark-applied", "not-now", "stop-next"])
})

test("what was done is not offered again, and a failure says so", () => {
  expect(plain(offerMessage({ matched: null, next }, "marked")?.text)).toBe(
    "Marked applied. Next in your queue: Staff Engineer at Globex.",
  )
  expect(plain(offerMessage({ matched, next: null }, "mark-failed")?.text)).toBe(
    "Could not mark it applied. Submitted Backend Engineer at Acme?",
  )
  expect(offerMessage({ matched, next: null }, "opened")?.actions).toEqual(["mark-applied", "not-now", "stop-next"])
  expect(plain(offerMessage({ matched, next }, "mark-failed")?.text)?.startsWith("Could not mark it applied.")).toBe(
    true,
  )
  expect(offerMessage({ matched: null, next: null }, "marked")).toEqual({ text: "Marked applied." })
  expect(offerMessage({ matched: null, next: null })).toBeNull()
})

test("each job text is isolated, so a title in another script keeps its order in the sentence", () => {
  const text = offerMessage({ matched: null, next: { title: "مهندس برمجيات", company: "Globex" } })?.text ?? ""
  expect(text).toContain("\u2068مهندس برمجيات\u2069 at \u2068Globex\u2069")
})
