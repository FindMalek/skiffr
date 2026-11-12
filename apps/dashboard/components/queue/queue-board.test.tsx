import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import type { Job, JobCounts } from "@skiffr/common/schemas"
import { orpc } from "@skiffr/orpc/react"
import { SidebarProvider } from "@skiffr/ui/components/sidebar"
import { TooltipProvider } from "@skiffr/ui/components/tooltip"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { DEFAULT_FILTERS, listInput } from "@/lib/queue"
import { type QueueApi, QueueApiProvider } from "./queue-api"
import { QueueBoard } from "./queue-board"

const cp = (...codes: number[]) => String.fromCodePoint(...codes)

const job = (n: number, extra: Partial<Job> = {}): Job => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  url: `https://jobs.acme.dev/${n}`,
  canonicalId: `acme:${n}`,
  title: `Role ${n}`,
  company: "Acme",
  source: "manual",
  status: "queued",
  queuedAt: new Date(Date.UTC(2026, 10, 10, 10, n)),
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...extra,
})

let root: Root
let host: HTMLElement
let client: QueryClient
const network = (globalThis as { __network?: string[] }).__network ?? []

beforeEach(() => {
  network.length = 0
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function counts(rows: Job[]): JobCounts {
  const status = { queued: 0, applied: 0, skipped: 0 }
  for (const row of rows) status[row.status] += 1
  return { status, sources: [{ source: "manual", count: rows.length }] }
}

async function mount(rows: Job[], api: Partial<QueueApi> = {}) {
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } } })
  client.setQueryData(orpc.jobs.list.queryKey({ input: listInput(DEFAULT_FILTERS) }), rows)
  client.setQueryData(orpc.jobs.counts.queryKey(), counts(rows))
  client.setQueryData(orpc.jobs.next.queryKey(), rows[0] ?? null)
  const fake = {
    create: mock(async () => ({ ...job(9), created: true })),
    setStatus: mock(async () => ({})),
    remove: mock(async () => ({})),
    markApplied: mock(async () => ({})),
    next: mock(async () => rows[0] ?? null),
    ...api,
  } as QueueApi
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <QueueApiProvider value={fake}>
          <TooltipProvider>
            <SidebarProvider>
              <QueueBoard />
            </SidebarProvider>
          </TooltipProvider>
        </QueueApiProvider>
      </QueryClientProvider>,
    )
  })
  return fake
}

const table = () => host.querySelector('[data-view="jobs"]') as HTMLElement
const button = (label: string) => table().querySelector(`button[aria-label^="${label}"]`) as HTMLButtonElement

test("job text is shown as text: no markup, no javascript link, no hidden direction characters", async () => {
  const evil = cp(0x202e)
  await mount([
    job(1, { title: "<img src=x onerror=alert(1)>", company: `Ac${evil}me` }),
    job(2, { url: "javascript:alert(document.cookie)", title: "Script link" }),
    job(3, { url: "https://google.com@evil.example/jobs/3", title: "Credentials link" }),
    job(4, { url: "https://jobs.acme.dev/4?a=1", title: "Real link" }),
  ])
  expect(host.querySelector("img")).toBeNull()
  expect(table().textContent).toContain("<img src=x onerror=alert(1)>")
  expect(table().textContent).toContain("Ac[U+202E]me")
  expect(table().textContent).not.toContain(evil)

  const anchors = [...host.querySelectorAll("a[href]")].filter((a) => !a.closest("nav, aside, header"))
  expect(anchors.length).toBeGreaterThan(0)
  for (const a of anchors) {
    expect(a.getAttribute("href")).toMatch(/^https:\/\/jobs\.acme\.dev\//)
    expect(a.getAttribute("target")).toBe("_blank")
    expect(a.getAttribute("rel")).toBe("noopener noreferrer")
  }
  expect(host.innerHTML).not.toMatch(/(href|src|action)="\s*javascript:/i)
  expect(host.querySelector('a[href^="javascript"]')).toBeNull()
  expect(host.querySelector('a[href*="evil.example"]')).toBeNull()
  expect(button("Open Script link")).toBeNull()
  const blocked = [...table().querySelectorAll("button[disabled]")].filter((b) => b.textContent === "Blocked")
  expect(blocked).toHaveLength(2)
  expect(table().textContent).toContain("jobs.acme.dev")
  expect(network).toEqual([])
})

test("two quick clicks on Skip send one request, the row shows Skipped at once and leaves when confirmed", async () => {
  let finish: () => void = () => {}
  const setStatus = mock(
    (_ids: readonly string[], _status: "queued" | "skipped") =>
      new Promise<unknown>((resolve) => (finish = () => resolve({}))),
  )
  await mount([job(1), job(2)], { setStatus })

  await act(async () => {
    button("Skip").click()
    button("Skip").click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  expect(setStatus).toHaveBeenCalledTimes(1)
  expect(setStatus.mock.calls[0]).toEqual([[job(1).id], "skipped"])
  expect(table().querySelectorAll("tbody tr")).toHaveLength(2)
  expect(table().querySelector("tbody tr")?.textContent).toContain("Skipped")
  expect(host.textContent).toMatch(/Queued\s*1/)

  await act(async () => finish())
  expect(setStatus).toHaveBeenCalledTimes(1)
  expect(table().querySelectorAll("tbody tr")).toHaveLength(1)
})

test("a failed skip puts that row back with its counts, and leaves the other rows alone", async () => {
  const setStatus = mock(async (ids: readonly string[]) => {
    if (ids[0] === job(1).id) throw new Error("boom")
    return {}
  })
  await mount([job(1), job(2), job(3)], { setStatus })

  await act(async () => {
    button("Skip: Role 2").click()
  })
  await act(async () => {
    button("Skip: Role 1").click()
  })
  const titles = [...table().querySelectorAll("tbody tr")].map((row) => row.textContent)
  expect(titles).toHaveLength(2)
  expect(titles[0]).toContain("Role 1")
  expect(titles[1]).toContain("Role 3")
  expect(host.textContent).toMatch(/Queued\s*2/)
  expect(host.textContent).toMatch(/Skipped\s*1/)
})

test("an invalid or non-http link is refused before anything is sent, and a double submit sends one request", async () => {
  let finish: (created: boolean) => void = () => {}
  const create = mock(
    () => new Promise<Job & { created: boolean }>((resolve) => (finish = (created) => resolve({ ...job(9), created }))),
  )
  await mount([job(1)], { create })
  const url = host.querySelector("#job-url") as HTMLInputElement
  const form = url.closest("form") as HTMLFormElement
  const type = async (value: string) => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      setter?.call(url, value)
      url.dispatchEvent(new Event("input", { bubbles: true }))
    })
  }
  const submit = () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))

  for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://acme.dev/a", "not a url"]) {
    await type(bad)
    await act(async () => void submit())
    expect(create).not.toHaveBeenCalled()
    expect(host.querySelector("#job-url-result")?.textContent).toContain("http:// or https://")
  }

  await type("https://jobs.acme.dev/9")
  await act(async () => {
    submit()
    submit()
  })
  expect(create).toHaveBeenCalledTimes(1)
  await act(async () => finish(false))
  expect(host.querySelector("#job-url-result")?.textContent).toContain("Already saved as")
  expect(host.querySelector("#job-url-result")?.textContent).toContain("Nothing was added")
})

async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  }
}

const openNext = () =>
  [...host.querySelectorAll("header button")].find((b) => b.textContent?.startsWith("Open next")) as HTMLButtonElement

test("Open next asks the server when it is pressed and opens what it answers, not the stale job on screen", async () => {
  const opened = mock((..._args: unknown[]) => null)
  window.open = opened as unknown as typeof window.open
  const next = mock(async () => job(2))
  await mount([job(1), job(2)], { next })
  expect(openNext().textContent).toContain("Role 1")

  await act(async () => {
    openNext().click()
  })
  expect(next).toHaveBeenCalledTimes(1)
  expect(opened).toHaveBeenCalledTimes(1)
  expect(opened.mock.calls[0]).toEqual([job(2).url, "_blank", "noopener,noreferrer"])
  await until(() => Boolean(openNext().textContent?.includes("Role 2")))
  expect(openNext().textContent).toContain("Role 2")

  next.mockImplementation(async () => null as never)
  await act(async () => {
    openNext().click()
  })
  expect(opened).toHaveBeenCalledTimes(1)
})

test("Open next never opens a link that is not a web address", async () => {
  const opened = mock((..._args: unknown[]) => null)
  window.open = opened as unknown as typeof window.open
  await mount([job(1)], { next: mock(async () => job(1, { url: "javascript:alert(1)" })) })
  await act(async () => {
    openNext().click()
  })
  expect(opened).not.toHaveBeenCalled()
})

test("accessible names use the neutralized, clipped text, and a changing row's Open link is disabled", async () => {
  let finish: () => void = () => {}
  const setStatus = mock(
    (_ids: readonly string[], _status: "queued" | "skipped") =>
      new Promise<unknown>((resolve) => (finish = () => resolve({}))),
  )
  await mount([job(1, { title: `Evil${cp(0x202e)}title${cp(0x7)} ${"x".repeat(5000)}` }), job(2)], { setStatus })
  const names = [...table().querySelectorAll("[aria-label]")].map((el) => el.getAttribute("aria-label") ?? "")
  expect(names.length).toBeGreaterThan(5)
  for (const name of names) {
    expect(name).not.toContain(cp(0x202e))
    expect(name).not.toContain(cp(0x7))
    expect(name.length).toBeLessThan(160)
  }
  expect(names.some((name) => name.includes("[U+202E]"))).toBe(true)

  const rows = () => [...table().querySelectorAll("tbody tr")]
  await act(async () => {
    button("Skip: Role 2").click()
  })
  expect(rows()[1]?.querySelector("a[href]")).toBeNull()
  expect(rows()[1]?.querySelector("button[disabled]")?.textContent).toBe("Open")
  expect(rows()[0]?.querySelector("a[href]")).not.toBeNull()
  await act(async () => finish())
})

test("a bulk skip keeps the selection until the server answers, and a failed one keeps it", async () => {
  let settle: (ok: boolean) => void = () => {}
  const setStatus = mock(
    (_ids: readonly string[], _status: "queued" | "skipped") =>
      new Promise<unknown>((resolve, reject) => (settle = (ok) => (ok ? resolve({}) : reject(new Error("boom"))))),
  )
  await mount([job(1), job(2), job(3)], { setStatus })
  const bulk = () => host.querySelector('section[aria-label="Bulk actions"]')
  await act(async () => {
    for (const box of [...table().querySelectorAll("tbody input[type=checkbox]")].slice(0, 2))
      (box as HTMLInputElement).click()
  })
  expect(bulk()?.textContent).toContain("2 selected")
  const skip = () =>
    [...bulk()!.querySelectorAll("button")].find((b) => b.textContent === "Skip selected") as HTMLButtonElement

  await act(async () => {
    skip().click()
  })
  expect(setStatus).toHaveBeenCalledTimes(1)
  expect(bulk()?.textContent).toContain("2 selected")
  await act(async () => settle(false))
  expect(bulk()?.textContent).toContain("2 selected")

  await act(async () => {
    skip().click()
  })
  await act(async () => settle(true))
  expect(bulk()).toBeNull()
})
