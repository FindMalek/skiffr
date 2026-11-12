import { afterEach, expect, spyOn, test } from "bun:test"
import { act } from "react"
import { hydrateRoot, type Root } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { Time } from "./time"

// Usage: <RelativeTime value={job.queuedAt} /> for lists, <Time mode="absolute" value={at} time={false} /> for a date.
// Server and first client render show the UTC date in en-GB; the viewer's relative text replaces it after hydration.

const VALUE = new Date("2026-11-13T10:00:00Z")
const NOW = Date.parse("2026-11-13T12:00:00Z")

let root: Root | undefined
let host: HTMLElement | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  root = undefined
})

async function hydrate(node: React.ReactElement): Promise<{ html: string; errors: unknown[][] }> {
  const html = renderToString(node)
  host = document.createElement("div")
  host.innerHTML = html
  document.body.append(host)
  const errors: unknown[][] = []
  const spy = spyOn(console, "error").mockImplementation((...args) => {
    errors.push(args)
  })
  await act(async () => {
    root = hydrateRoot(host as HTMLElement, node)
  })
  spy.mockRestore()
  return { html, errors }
}

test("server markup is a fixed UTC date, and hydration upgrades it with no warning", async () => {
  const realNow = Date.now
  Date.now = () => NOW
  try {
    const node = <Time value={VALUE} />
    const { html, errors } = await hydrate(node)
    expect(html).toMatch(/datetime="2026-11-13T10:00:00.000Z"/i)
    expect(html).toContain(">13 Nov 2026<")
    expect(html).toContain("--time-width:11ch")

    const time = (host as HTMLElement).querySelector("time") as HTMLTimeElement
    expect(time.dateTime).toBe("2026-11-13T10:00:00.000Z")
    expect(time.textContent).toStartWith("2h ago")
    expect(time.title).toContain("2026")
    // the exact time is also in the text for screen readers, not only the tooltip
    expect(time.querySelector(".sr-only")?.textContent).toContain("2026")
    expect(errors).toEqual([])
  } finally {
    Date.now = realNow
  }
})

test("an invalid value renders n/a and no time element", () => {
  for (const value of [null, undefined, "garbage"]) {
    const html = renderToString(<Time value={value} />)
    expect(html).toContain("n/a")
    expect(html).not.toContain("<time")
  }
})

test("one shared interval for every Time, cleared on unmount and while the tab is hidden", async () => {
  const set = spyOn(globalThis, "setInterval")
  const clear = spyOn(globalThis, "clearInterval")
  const before = set.mock.calls.length
  const node = (
    <>
      <Time value={VALUE} />
      <Time value={VALUE} />
      <Time value={VALUE} mode="absolute" />
    </>
  )
  host = document.createElement("div")
  host.innerHTML = renderToString(node)
  document.body.append(host)
  await act(async () => {
    root = hydrateRoot(host as HTMLElement, node)
  })
  expect(set.mock.calls.length - before).toBe(1)
  expect(set.mock.calls.at(-1)?.[1]).toBe(60_000)

  let hiddenNow = true
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hiddenNow })
  const cleared = clear.mock.calls.length
  document.dispatchEvent(new Event("visibilitychange"))
  expect(clear.mock.calls.length).toBeGreaterThan(cleared)

  hiddenNow = false
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"))
  })
  expect(set.mock.calls.length - before).toBe(2)

  const afterVisible = clear.mock.calls.length
  await act(async () => root?.unmount())
  root = undefined
  expect(clear.mock.calls.length).toBeGreaterThan(afterVisible)
  Reflect.deleteProperty(document, "hidden")
  set.mockRestore()
  clear.mockRestore()
})
