import { expect, test } from "bun:test"
import { offerMessage } from "./offer"

const matched = { title: "Backend Engineer", company: "Acme" }
const next = { title: "Staff Engineer", company: "Globex" }

test("both parts are offered with the not now and don't ask choices", () => {
  const message = offerMessage({ matched, next })
  expect(message?.text).toBe("Submitted Backend Engineer at Acme? Next in your queue: Staff Engineer at Globex.")
  expect(message?.actions).toEqual(["open-next", "mark-applied", "not-now", "stop-next"])
})

test("a page outside the queue only offers the next job", () => {
  const message = offerMessage({ matched: null, next })
  expect(message?.text).toBe("Next in your queue: Staff Engineer at Globex.")
  expect(message?.actions).toEqual(["open-next", "not-now", "stop-next"])
})

test("with nothing else queued only marking is offered", () => {
  const message = offerMessage({ matched, next: null })
  expect(message?.text).toBe("Submitted Backend Engineer at Acme? Your queue has nothing else.")
  expect(message?.actions).toEqual(["mark-applied", "not-now", "stop-next"])
})

test("what was done is not offered again, and a failure says so", () => {
  expect(offerMessage({ matched: null, next }, "marked")?.text).toBe(
    "Marked applied. Next in your queue: Staff Engineer at Globex.",
  )
  expect(offerMessage({ matched, next: null }, "mark-failed")?.text).toBe(
    "Could not mark it applied. Submitted Backend Engineer at Acme?",
  )
  expect(offerMessage({ matched, next: null }, "opened")?.actions).toEqual(["mark-applied", "not-now", "stop-next"])
  expect(offerMessage({ matched, next }, "mark-failed")?.text.startsWith("Could not mark it applied.")).toBe(true)
  expect(offerMessage({ matched: null, next: null }, "marked")).toEqual({ text: "Marked applied." })
  expect(offerMessage({ matched: null, next: null })).toBeNull()
})
