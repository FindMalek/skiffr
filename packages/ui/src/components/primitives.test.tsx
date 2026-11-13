import { expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { Card, CardTitle } from "./card"
import { Checkbox } from "./checkbox"
import { ErrorState } from "./error-state"
import { SegmentedControl, SegmentedControlItem } from "./segmented-control"
import { Section } from "./section"
import { StatusBadge, type StatusTone } from "./status-badge"

const mount = async (node: React.ReactNode): Promise<HTMLElement> => {
  const host = document.createElement("div")
  document.body.append(host)
  await act(async () => createRoot(host).render(node))
  return host
}

test("a status badge always shows its word and an icon, for every tone", () => {
  const tones: StatusTone[] = ["neutral", "strong", "success", "warning", "danger"]
  for (const tone of tones) {
    const html = renderToStaticMarkup(<StatusBadge tone={tone}>Queued</StatusBadge>)
    expect(html).toContain(`data-tone="${tone}"`)
    expect(html).toContain(">Queued<")
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain("<svg")
  }
})

test("a status colour is a border, never a background fill", () => {
  for (const tone of ["success", "warning", "danger"] as const) {
    expect(renderToStaticMarkup(<StatusBadge tone={tone}>x</StatusBadge>)).not.toMatch(/\bbg-(success|warning|destructive)/)
  }
})

test("section renders one h2 that labels its region", () => {
  const host = document.createElement("div")
  host.innerHTML = renderToStaticMarkup(
    <Section title="Devices" description="Where skiffr fills forms">
      body
    </Section>
  )
  const h2 = host.querySelectorAll("h2")
  expect(h2).toHaveLength(1)
  expect(host.querySelector("section")?.getAttribute("aria-labelledby")).toBe(h2[0]?.id)
})

test("a card title is a heading only when asked", () => {
  const html = renderToStaticMarkup(
    <Card>
      <CardTitle>One</CardTitle>
      <CardTitle as="h3">Two</CardTitle>
    </Card>
  )
  expect(html).not.toContain("<h2")
  expect(html).toContain("<h3")
})

test("an error state is an alert with the request id and the action", () => {
  const html = renderToStaticMarkup(
    <ErrorState title="Could not load jobs" requestId="req_1" action={<button type="button">Try again</button>} />
  )
  expect(html).toContain('role="alert"')
  expect(html).toContain("Request id: req_1")
  expect(html).toContain("Try again")
})

test("an indeterminate checkbox reports mixed and a click makes it checked", async () => {
  let checked: boolean | undefined
  const host = await mount(<Checkbox indeterminate aria-label="all" onCheckedChange={(v) => (checked = v)} />)
  const box = host.querySelector('[role="checkbox"]') as HTMLElement
  expect(box.getAttribute("aria-checked")).toBe("mixed")
  await act(async () => box.click())
  expect(checked).toBe(true)
})

test("a segmented control selects the clicked item and keeps one checked", async () => {
  let value = "queued"
  const host = await mount(
    <SegmentedControl aria-label="Status" defaultValue="queued" onValueChange={(v) => (value = String(v))}>
      <SegmentedControlItem value="queued">Queued</SegmentedControlItem>
      <SegmentedControlItem value="applied">Applied</SegmentedControlItem>
    </SegmentedControl>
  )
  const items = [...host.querySelectorAll('[role="radio"]')] as HTMLElement[]
  expect(items.map((i) => i.getAttribute("aria-checked"))).toEqual(["true", "false"])
  await act(async () => items[1]?.click())
  expect(value).toBe("applied")
  expect([...host.querySelectorAll('[role="radio"]')].map((i) => i.getAttribute("aria-checked"))).toEqual(["false", "true"])
})
