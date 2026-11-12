import { expect, test } from "bun:test"
import { boardOf, parseBoard } from "./boards"
import { ParseError } from "./errors"
import { parseJsonFeed, parseXmlFeed } from "./feeds"
import { parseHtml } from "./html"
import { plain } from "./postings"

const BASE = "https://acme.dev/careers"

test("plain text has no markup, entities or invisible characters left", () => {
  expect(plain("<b>Staff</b> Engineer &amp; Lead")).toBe("Staff Engineer & Lead")
  expect(plain("&lt;script&gt;alert(1)&lt;/script&gt; Dev")).not.toMatch(/[<>]/)
  expect(plain("<img src=x onerror=alert(1)>Dev<script>evil()</script>")).toBe("Dev")
  expect(plain("Dev‮evil​\u0000 role")).toBe("Dev evil role")
  expect(plain("x".repeat(500))).toHaveLength(200)
  expect(plain(42)).toBe("")
})

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Acme jobs</title><link>https://acme.dev</link>
  <item><title><![CDATA[Senior <b>Engineer</b> &amp; Lead]]></title><link>/careers/senior-engineer</link></item>
  <item><title>Designer</title><guid isPermaLink="true">https://acme.dev/careers/designer</guid></item>
  <item><title>No link</title></item>
  <item><title>Sneaky</title><link>javascript:alert(1)</link></item>
  <item><title>Inside</title><link>http://127.0.0.1/admin</link></item>
  <item><title>With creds</title><link>https://u:p@acme.dev/x</link></item>
</channel></rss>`

test("an rss feed gives its items with absolute links and plain titles, and drops unsafe links", () => {
  expect(parseXmlFeed(RSS, BASE, "Acme")).toEqual([
    { url: "https://acme.dev/careers/senior-engineer", title: "Senior Engineer & Lead", company: "Acme" },
    { url: "https://acme.dev/careers/designer", title: "Designer", company: "Acme" },
  ])
})

test("an atom feed uses the alternate link of each entry", () => {
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Acme</title>
    <entry><title type="html">&lt;b&gt;Data&lt;/b&gt; Engineer</title>
      <link rel="self" href="https://acme.dev/feed/1"/><link rel="alternate" href="https://acme.dev/careers/data"/></entry>
    <entry><title>Ops</title><link href="https://acme.dev/careers/ops"/></entry></feed>`
  expect(parseXmlFeed(atom, BASE, "Acme").map((p) => [p.title, p.url])).toEqual([
    ["Data Engineer", "https://acme.dev/careers/data"],
    ["Ops", "https://acme.dev/careers/ops"],
  ])
})

test("xml that is not a feed is unparseable, and an entity bomb is not expanded", () => {
  expect(() => parseXmlFeed("<html><body>hi</body></html>", BASE, "Acme")).toThrow(ParseError)
  const lol = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY a "${"lol".repeat(1_000)}"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>
    <rss><channel><item><title>&b;&b;&b;&b;</title><link>https://acme.dev/careers/x</link></item></channel></rss>`
  const [posting] = parseXmlFeed(lol, BASE, "Acme")
  expect(posting?.title.length).toBeLessThan(200)
})

test("a json feed gives items by url or external_url, and anything else is unparseable", () => {
  const feed = JSON.stringify({
    version: "https://jsonfeed.org/version/1.1",
    items: [
      { url: "https://acme.dev/careers/a", title: "A" },
      { external_url: "https://other.example/jobs/b", title: "B" },
      { title: "no link" },
      "junk",
    ],
  })
  expect(parseJsonFeed(feed, BASE, "Acme").map((p) => p.title)).toEqual(["A", "B"])
  expect(() => parseJsonFeed("not json", BASE, "Acme")).toThrow(ParseError)
  expect(() => parseJsonFeed('{"items":3}', BASE, "Acme")).toThrow(ParseError)
})

test("board urls map to their public api from the exact vendor host only", () => {
  const board = (url: string) => boardOf(url)
  expect(board("https://boards.greenhouse.io/Acme")).toEqual({
    kind: "greenhouse",
    api: "https://boards-api.greenhouse.io/v1/boards/acme/jobs",
  })
  expect(board("https://job-boards.eu.greenhouse.io/acme/jobs/123")?.api).toBe(
    "https://boards-api.greenhouse.io/v1/boards/acme/jobs",
  )
  expect(board("https://boards.greenhouse.io/embed/job_board?for=acme")?.api).toBe(
    "https://boards-api.greenhouse.io/v1/boards/acme/jobs",
  )
  expect(board("https://jobs.lever.co/acme")?.api).toBe("https://api.lever.co/v0/postings/acme?mode=json")
  expect(board("https://jobs.eu.lever.co/acme")?.api).toBe("https://api.eu.lever.co/v0/postings/acme?mode=json")
  expect(board("https://jobs.ashbyhq.com/acme")?.api).toBe("https://api.ashbyhq.com/posting-api/job-board/acme")
  expect(board("https://apply.workable.com/acme/")?.api).toBe("https://apply.workable.com/api/v1/widget/accounts/acme")
  expect(board("https://acme.workable.com/")?.api).toBe("https://apply.workable.com/api/v1/widget/accounts/acme")
  for (const notABoard of [
    "https://acme.dev/boards.greenhouse.io/acme",
    "https://boards.greenhouse.io.evil.test/acme",
    "https://evil.test/jobs.lever.co/acme",
    "https://jobs.lever.co/",
    "https://jobs.lever.co/a%2F..%2Fb",
    "https://jobs.lever.co/acme%0d%0ax",
    "https://www.workable.com/",
    "https://acme.dev/careers",
  ]) {
    expect(board(notABoard)).toBeNull()
  }
})

test("each board's listing becomes postings with the vendor's links", () => {
  const greenhouse = {
    jobs: [
      { id: 1, title: "Engineer", absolute_url: "https://boards.greenhouse.io/acme/jobs/1", company_name: "Acme Inc" },
    ],
  }
  expect(parseBoard("greenhouse", JSON.stringify(greenhouse), "https://boards-api.greenhouse.io/x", "acme")).toEqual([
    { url: "https://boards.greenhouse.io/acme/jobs/1", title: "Engineer", company: "Acme Inc" },
  ])
  const lever = [
    { id: "a", text: "Designer", hostedUrl: "https://jobs.lever.co/acme/aaaaaaaa-0000-0000-0000-000000000001" },
  ]
  expect(parseBoard("lever", JSON.stringify(lever), "https://api.lever.co/x", "Acme")[0]).toMatchObject({
    title: "Designer",
    company: "Acme",
  })
  const ashby = {
    jobs: [
      { title: "PM", jobUrl: "https://jobs.ashbyhq.com/acme/1", isListed: true },
      { title: "Hidden", jobUrl: "https://jobs.ashbyhq.com/acme/2", isListed: false },
    ],
  }
  expect(parseBoard("ashby", JSON.stringify(ashby), "https://api.ashbyhq.com/x", "Acme").map((p) => p.title)).toEqual([
    "PM",
  ])
  const workable = { name: "Acme Ltd", jobs: [{ title: "QA", url: "https://apply.workable.com/acme/j/ABC123/" }] }
  expect(parseBoard("workable", JSON.stringify(workable), "https://apply.workable.com/x", "acme")).toEqual([
    { url: "https://apply.workable.com/acme/j/ABC123/", title: "QA", company: "Acme Ltd" },
  ])
  expect(() => parseBoard("lever", '{"not":"a list"}', "https://api.lever.co/x", "Acme")).toThrow(ParseError)
})

test("json-ld job postings win, whether listed, in a graph or nested in an item list", () => {
  const page = `<html><head>
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Acme"},
      {"@type":"JobPosting","title":"<i>Rust</i> Developer","url":"/careers/rust","hiringOrganization":{"@type":"Organization","name":"Acme Labs"}}]}</script>
    <script type="application/ld+json">[{"@type":["JobPosting"],"title":"Go Developer","url":"https://acme.dev/careers/go","hiringOrganization":"Acme"}]</script>
    <script type="application/ld+json">{ broken json</script>
    </head><body><a href="/careers/ignored-because-ld-exists">Some other job</a></body></html>`
  expect(parseHtml(page, BASE, "Fallback")).toEqual([
    { url: "https://acme.dev/careers/rust", title: "Rust Developer", company: "Acme Labs" },
    { url: "https://acme.dev/careers/go", title: "Go Developer", company: "Acme" },
  ])
})

test("without json-ld, only links that read like a posting on the page's host or a known board are kept", () => {
  const page = `<body><nav><a href="/">Home</a><a href="/careers">Careers</a><a href="/about">About us</a></nav>
    <a href="/careers/senior-engineer">Senior Engineer</a>
    <a href="/jobs/42?utm_source=x#apply">Product Designer</a>
    <a href="https://www.acme.dev/careers/ops-lead">Ops Lead</a>
    <a href="https://boards.greenhouse.io/acme/jobs/777">Support Engineer</a>
    <a href="https://evil.test/careers/free-money">Free money job</a>
    <a href="/careers/apply">Apply now</a>
    <a href="javascript:alert(1)">Click me for a job</a>
    <a href="/careers/senior-engineer">Senior Engineer again</a>
    <a href="http://127.0.0.1/jobs/1">Internal job</a></body>`
  expect(parseHtml(page, BASE, "Acme").map((p) => [p.title, p.url])).toEqual([
    ["Senior Engineer", "https://acme.dev/careers/senior-engineer"],
    ["Product Designer", "https://acme.dev/jobs/42?utm_source=x"],
    ["Ops Lead", "https://www.acme.dev/careers/ops-lead"],
    ["Support Engineer", "https://boards.greenhouse.io/acme/jobs/777"],
  ])
})

test("hostile html is read within bounds: deep nesting, endless anchors and huge json-ld", () => {
  const nested = "<div>".repeat(200_000)
  const anchors = Array.from({ length: 40_000 }, (_, i) => `<a href="/jobs/${i}">Engineer number ${i}</a>`).join("")
  const hugeLd = `<script type="application/ld+json">${"[".repeat(100_000)}</script>`
  const started = performance.now()
  const found = parseHtml(`${nested}${hugeLd}${anchors}`, BASE, "Acme")
  expect(performance.now() - started).toBeLessThan(20_000)
  expect(found.length).toBeGreaterThan(0)
  expect(found.length).toBeLessThanOrEqual(500)
})
