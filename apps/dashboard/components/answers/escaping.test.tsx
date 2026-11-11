import { expect, test } from "bun:test"
import type { Answer } from "@skiffr/common/schemas"
import { orpc } from "@skiffr/orpc/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderToString } from "react-dom/server"
import { bankKey } from "@/lib/answers"
import { AnswerBank } from "./answer-bank"
import { SuggestionsPanel } from "./suggestions-panel"

const LABEL = "<img src=x onerror=alert(1)>"
const VALUE = '"><script>alert(2)</script> javascript:alert(3)'

const evil: Answer = {
  id: "00000000-0000-4000-8000-000000000001",
  normalizedLabel: "img src x onerror alert 1",
  rawLabel: LABEL,
  value: VALUE,
  source: "autofill",
  timesUsed: 1,
  timesCorrected: 2,
  status: "learned",
  lastCorrectedAt: new Date("2026-02-02T00:00:00Z"),
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-02-02T00:00:00Z"),
}

function render(node: React.ReactNode, seed: (client: QueryClient) => void) {
  const client = new QueryClient()
  seed(client)
  return renderToString(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

test("a label and a value from a web page render as text, never as markup", () => {
  const html = render(<AnswerBank />, (client) => client.setQueryData(bankKey(orpc.answers.key()), [evil]))
  expect(html).not.toContain("<img")
  expect(html).not.toContain("<script")
  expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;")
  expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;")
  expect(html).not.toMatch(/href="javascript/)
  expect(html).toContain('dir="auto"')
})

test("the same holds in a suggestion card", () => {
  const html = render(<SuggestionsPanel />, (client) =>
    client.setQueryData(orpc.learning.suggestions.queryKey(), [{ kind: "keep", answer: evil, count: 2 }]),
  )
  expect(html).not.toContain("<img")
  expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;")
})
