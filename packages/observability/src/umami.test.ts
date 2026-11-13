import { afterAll, expect, test } from "bun:test"
import { createObservability } from "./observability"
import { mockCollector } from "./testing"
import { umamiScript } from "./umami"

const collector = mockCollector()
afterAll(() => collector.stop())
const ID = "11111111-2222-4333-8444-555555555555"

test("the script is off without a valid origin and website id", () => {
  for (const [url, id] of [
    [undefined, ID],
    ["https://analytics.example.com", undefined],
    ["javascript:alert(1)", ID],
    ["https://user:pass@analytics.example.com", ID],
    ["https://analytics.example.com", "not-a-uuid"],
    ["https://analytics.example.com", `${ID}"+alert(1)+"`],
  ] as const)
    expect(umamiScript(url, id)).toBe("/* analytics off */\n")
})

test("the script respects do not track, drops search, hash and referrer, and hides record ids", () => {
  const script = umamiScript("https://analytics.example.com/", ID)
  expect(script).toContain("doNotTrack")
  expect(script).toContain("globalPrivacyControl")
  expect(script).toContain('"https://analytics.example.com/script.js"')
  expect(script).toContain("data-exclude-search")
  expect(script).toContain("data-exclude-hash")
  const hook = script.slice(script.indexOf("window.skiffrUmamiBeforeSend"), script.indexOf("var s="))
  const beforeSend = new Function("window", `${hook}; return window.skiffrUmamiBeforeSend`)({})
  const payload = beforeSend("event", {
    url: "/jobs/3f2c9a10-1b2c-4d3e-8f90-123456789abc/notes",
    referrer: "https://x.test",
  })
  expect(payload).toEqual({ url: "/jobs/:id/notes", referrer: "" })
})

test("an api event goes to umami with its allowlisted props only", async () => {
  collector.requests.length = 0
  const o = createObservability({
    service: "skiffr-api",
    environment: "test",
    umamiUrl: collector.url,
    umamiWebsiteId: ID,
  })
  o.track("ai_budget_exhausted", { limit: "daily", operation: "chat", email: "jane@example.com" })
  await Bun.sleep(30)
  const [request] = collector.requests
  expect(request?.path).toBe("/api/send")
  const body = JSON.parse(request?.body ?? "{}")
  expect(body.payload).toMatchObject({ website: ID, name: "ai_budget_exhausted", data: { limit: "daily" } })
  expect(request?.body).not.toContain("jane@example.com")
})
