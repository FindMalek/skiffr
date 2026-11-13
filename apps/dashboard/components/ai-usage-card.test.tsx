import { afterEach, beforeEach, expect, test } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { AiUsageCard } from "./ai-usage-card"

let root: Root
let host: HTMLElement

beforeEach(() => {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const render = (node: React.ReactNode) => act(async () => root.render(node))

test("usage shows used against the limit, what is left, and when it resets", async () => {
  await render(
    <AiUsageCard usage={{ day: "2026-11-10", calls: 12, tokens: 41_200, limits: { calls: 300, tokens: 1_000_000 } }} />,
  )
  const meters = [...host.querySelectorAll('[role="meter"]')]
  expect(meters.map((meter) => meter.getAttribute("aria-valuetext"))).toEqual([
    "12 of 300 calls, 288 left",
    "41.2K of 1M tokens, 958.8K left",
  ])
  expect(meters.map((meter) => [meter.getAttribute("aria-valuenow"), meter.getAttribute("aria-valuemax")])).toEqual([
    ["12", "300"],
    ["41200", "1000000"],
  ])
  expect(meters.every((meter) => document.getElementById(meter.getAttribute("aria-labelledby") ?? ""))).toBe(true)
  expect(host.textContent).toContain("288 left")
  expect(host.querySelector("time")?.getAttribute("datetime")).toBe("2026-11-11T00:00:00.000Z")
})

test("with no limit there is no meter and no reset time", async () => {
  await render(<AiUsageCard usage={{ day: "2026-11-10", calls: 1, tokens: 5, limits: { calls: 0, tokens: 0 } }} />)
  expect(host.querySelectorAll('[role="meter"]')).toHaveLength(0)
  expect(host.textContent).toContain("No daily limit.")
  expect(host.querySelector("time")).toBeNull()
})

test("when usage could not load the section says so instead of vanishing", async () => {
  await render(<AiUsageCard usage={null} />)
  expect(host.querySelector("h2")?.textContent).toBe("AI use")
  expect(host.textContent).toContain("not available right now")
})
