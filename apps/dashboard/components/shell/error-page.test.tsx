import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { PageHeader } from "@/components/page-header"
import { digestOf, ErrorPage, ROUTE_ERROR } from "./error-page"

test("a route error names the request id, offers a retry and always a way back to Today", () => {
  const html = renderToStaticMarkup(<ErrorPage {...ROUTE_ERROR} requestId="abc123" onRetry={() => {}} />)
  expect(html).toContain("Request id: abc123")
  expect(html).toContain("<button")
  expect(html).toContain('href="/"')
  expect(html).toContain("Go to Today")
  expect(renderToStaticMarkup(<ErrorPage {...ROUTE_ERROR} />)).not.toContain("<button")
  expect(digestOf(Object.assign(new Error("x"), { digest: "d1" }))).toBe("d1")
  expect(digestOf("thrown string")).toBeUndefined()
})

test("the page header renders one h1 and a breadcrumb only for nested pages", () => {
  const flat = renderToStaticMarkup(<PageHeader title="Queue" />)
  expect(flat.match(/<h1/g)).toHaveLength(1)
  expect(flat).not.toContain("breadcrumb")
  const nested = renderToStaticMarkup(
    <PageHeader
      title="Extension"
      breadcrumb={[{ label: "Settings", href: "/settings/account" }, { label: "Extension" }]}
    />,
  )
  expect(nested.match(/<h1/g)).toHaveLength(1)
  expect(nested).toContain('aria-label="breadcrumb"')
  expect(nested).toContain('aria-current="page"')
})
