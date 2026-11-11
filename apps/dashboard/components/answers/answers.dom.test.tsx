import { afterEach, expect, test } from "bun:test"
import type { Answer } from "@skiffr/common/schemas"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { installDom, rpc } from "./test-dom"

installDom()
const { orpc } = await import("@skiffr/orpc/react")
const { bankKey } = await import("@/lib/answers")
const { AnswerBank } = await import("./answer-bank")
const { SuggestionsPanel } = await import("./suggestions-panel")

const LABEL = "<img src=x onerror=alert(1)>"
const VALUE = '"><script>alert(2)</script> javascript:alert(3)'

function answer(over: Partial<Answer> = {}): Answer {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    normalizedLabel: "salary",
    rawLabel: "Salary",
    value: "100",
    source: "autofill",
    timesUsed: 1,
    timesCorrected: 2,
    status: "learned",
    lastCorrectedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-02-02T00:00:00Z"),
    ...over,
  }
}

let root: Root | undefined
let host: HTMLElement
afterEach(async () => {
  await act(async () => root?.unmount())
  host.remove()
  rpc.calls.length = 0
})

async function mount(node: React.ReactNode, seed: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } })
  seed(client)
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root?.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>))
}

const wait = (ms: number) => act(async () => void (await new Promise((resolve) => setTimeout(resolve, ms))))

test("a label and a value from a web page become text nodes, never elements or attributes", async () => {
  const evil = answer({ rawLabel: LABEL, value: VALUE, normalizedLabel: "img src x onerror alert 1" })
  await mount(
    <>
      <AnswerBank />
      <SuggestionsPanel />
    </>,
    (client) => {
      client.setQueryData(bankKey(orpc.answers.key()), [evil])
      client.setQueryData(orpc.learning.suggestions.queryKey(), [{ kind: "keep", answer: evil, count: 2 }])
    },
  )
  expect(host.textContent).toContain(LABEL)
  expect(host.textContent).toContain(VALUE)
  expect(host.querySelectorAll("img, script, iframe, style, svg[onload], a")).toHaveLength(0)
  for (const element of host.querySelectorAll("*")) {
    for (const name of element.getAttributeNames()) expect(name.startsWith("on")).toBe(false)
  }
  expect(host.querySelectorAll('[dir="auto"]').length).toBeGreaterThan(0)
})

test("two quick clicks on Stop filling send one request and the answer ends rejected, not toggled back", async () => {
  const row = answer()
  const server = { status: row.status as Answer["status"] }
  rpc.handler = async ({ path, input }) => {
    if (path === "learning/resolveSuggestion") {
      await new Promise((resolve) => setTimeout(resolve, 100))
      server.status = (input as { decision: string }).decision === "reject" ? "rejected" : "confirmed"
      return row
    }
    if (path === "answers/list") return [{ ...row, status: server.status }]
    return []
  }
  await mount(<AnswerBank />, (client) => client.setQueryData(bankKey(orpc.answers.key()), [row]))

  const stop = () => host.querySelector<HTMLButtonElement>('[aria-label^="Stop filling"]')
  const button = stop()
  expect(button).not.toBeNull()
  await act(async () => button?.click())
  // the optimistic update has already swapped the button for Restore: the next click must not turn into a keep
  const restore = host.querySelector<HTMLButtonElement>('[aria-label^="Restore"]')
  expect(restore).not.toBeNull()
  expect(restore?.getAttribute("aria-disabled")).toBe("true")
  await act(async () => restore?.click())
  await act(async () => restore?.click())
  await wait(250)

  const sent = rpc.calls.filter((call) => call.path === "learning/resolveSuggestion")
  expect(sent).toHaveLength(1)
  expect(sent[0]?.input).toEqual({ answerId: row.id, decision: "reject" })
  expect(server.status).toBe("rejected")
  expect(host.textContent).toContain("Rejected")

  // once the request is done the row takes a new click again, as an explicit restore
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label^="Restore"]')?.click())
  await wait(250)
  expect(rpc.calls.filter((call) => call.path === "learning/resolveSuggestion").map((c) => c.input)).toEqual([
    { answerId: row.id, decision: "reject" },
    { answerId: row.id, decision: "keep" },
  ])
  expect(server.status).toBe("confirmed")
})
