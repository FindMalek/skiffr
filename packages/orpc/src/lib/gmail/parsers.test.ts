import { expect, test } from "bun:test"
import { canonicalizeJobUrl } from "./canonical"
import { open, parseKey, seal } from "./crypto"
import {
  GLASSDOOR_ALERT,
  HOSTILE_ALERT,
  INDEED_ALERT,
  LINKEDIN_ALERT,
  NEWSLETTER,
  OTHER_ALERT,
  WELLFOUND_ALERT,
} from "./fixtures"
import { parseEmail } from "./parsers"
import { buildQuery, fromAddress, isWatched, normalizeSender, providerOf } from "./senders"
import { cleanText } from "./text"

test("entities in titles and companies are decoded without gaps", () => {
  const jobs = parseEmail("linkedin", {
    html: '<a href="https://www.linkedin.com/jobs/view/1234567">R&amp;D Engineer, Women&#39;s Health, C&#43;&#43;</a><p>AT&amp;T &eacute;</p><p>Remote</p>',
  })
  expect(jobs.map((j) => [j.title, j.company])).toEqual([["R&D Engineer, Women's Health, C++", "AT&T é"]])
})

test("only real vendor domains count as a board", () => {
  const id = "abcdef0123456789"
  for (const host of ["indeed.xyz", "evil.indeed.cc", "indeed.top"])
    expect(canonicalizeJobUrl(`https://www.${host}/viewjob?jk=${id}`)).toMatchObject({
      canonicalId: expect.not.stringMatching(/^indeed:/),
    })
  expect(canonicalizeJobUrl(`https://uk.indeed.com/viewjob?jk=${id}`)).toMatchObject({ canonicalId: `indeed:${id}` })
  expect(canonicalizeJobUrl(`https://www.indeed.co.uk/viewjob?jk=${id}`)).toMatchObject({ canonicalId: `indeed:${id}` })
  expect(canonicalizeJobUrl("https://www.glassdoor.tk/job-listing/j?jl=1234567")).toMatchObject({
    canonicalId: expect.not.stringMatching(/^glassdoor:/),
  })
  const html = `<a href="https://www.indeed.xyz/viewjob?jk=${id}">Backend Developer</a><p>Globex</p>`
  expect(parseEmail("indeed", { html })).toEqual([])
})

test("linkedin alert (approximated layout): jobs, companies and locations, tracking stripped", () => {
  const jobs = parseEmail("linkedin", { html: LINKEDIN_ALERT })
  expect(jobs).toEqual([
    {
      title: "Senior Software Engineer",
      company: "Acme Labs",
      location: "Berlin, Germany",
      url: "https://www.linkedin.com/jobs/view/3912345678",
      canonicalId: "linkedin:3912345678",
      unresolved: false,
    },
    {
      title: "Backend Developer",
      company: "Globex",
      location: "Remote",
      url: "https://www.linkedin.com/jobs/view/3987654321",
      canonicalId: "linkedin:3987654321",
      unresolved: false,
    },
  ])
})

test("indeed alert (approximated layout): jk links become indeed ids, salary lines are not companies", () => {
  const jobs = parseEmail("indeed", { html: INDEED_ALERT })
  expect(jobs.map((j) => [j.canonicalId, j.title, j.company, j.location])).toEqual([
    ["indeed:a1b2c3d4e5f60718", "Data Analyst", "Initech", "Remote"],
    ["indeed:0f1e2d3c4b5a6978", "Reporting Specialist", "Hooli", "Austin, TX"],
  ])
  expect(jobs[0]?.url).toBe("https://www.indeed.com/viewjob?jk=a1b2c3d4e5f60718")
})

test("glassdoor alert (approximated layout): jobListingId and jl both give the id", () => {
  const jobs = parseEmail("glassdoor", { html: GLASSDOOR_ALERT })
  expect(jobs.map((j) => [j.canonicalId, j.title, j.company, j.location])).toEqual([
    ["glassdoor:1009876543210", "Product Designer", "Umbrella Corp", "Paris"],
    ["glassdoor:1009123456789", "Brand Designer", "Initech", "Lyon"],
  ])
})

test("wellfound alert (approximated layout)", () => {
  const [job, ...rest] = parseEmail("wellfound", { html: WELLFOUND_ALERT })
  expect(rest).toEqual([])
  expect(job).toMatchObject({ canonicalId: "wellfound:3456789", title: "Staff Engineer", company: "Hooli" })
  expect(job?.url).toBe("https://wellfound.com/jobs/3456789")
})

test("generic sender: links read from the url, tracker redirects kept as they came and flagged, footer links ignored", () => {
  const jobs = parseEmail("other", { html: OTHER_ALERT })
  expect(jobs).toHaveLength(2)
  expect(jobs[0]).toMatchObject({
    title: "Platform Engineer",
    company: "StartupCo",
    location: "Lisbon",
    canonicalId: "greenhouse:startupco:4455667",
    url: "https://job-boards.greenhouse.io/startupco/jobs/4455667",
    unresolved: false,
  })
  expect(jobs[1]).toMatchObject({
    title: "Site Reliability Engineer",
    url: "https://click.startup.example/ls/click?upn=u001.abcdef",
    unresolved: true,
  })
  expect(jobs[1]?.canonicalId).toMatch(/^redirect:[0-9a-f]{32}$/)
})

test("an email with no postings gives nothing, and a lookalike host or javascript link is never a job", () => {
  expect(parseEmail("linkedin", { html: NEWSLETTER })).toEqual([])
  const hostile = parseEmail("linkedin", {
    html: HOSTILE_ALERT(String.fromCodePoint(0x202e) + String.fromCodePoint(0)),
  })
  expect(hostile.map((j) => j.canonicalId)).toEqual(["linkedin:5550001112"])
  expect(hostile[0]?.title).toBe("Staff Engineer")
  expect(hostile[0]?.company).toBe("Initech")
  const ghost = `<script><a href="https://www.linkedin.com/comm/jobs/view/7654321">Ghost Engineer</a></script>`
  expect(parseEmail("linkedin", { html: ghost })).toEqual([])
})

test("text is plain: control, bidi and zero width characters go, length is capped", () => {
  const dirty = `a${String.fromCodePoint(0x202e)}b${String.fromCodePoint(0)}c${String.fromCodePoint(0x200b)}d${String.fromCodePoint(0xd800)}e`
  expect(cleanText(dirty)).toBe("a b c de")
  const long = cleanText("x".repeat(500))
  expect(Array.from(long)).toHaveLength(200)
  expect(long.endsWith("…")).toBe(true)
})

test("canonical ids: tracking parameters and fragments are dropped, boards reduce to their id", () => {
  const id = (url: string) => {
    const result = canonicalizeJobUrl(url)
    return result?.kind === "job" ? result.canonicalId : result?.kind
  }
  expect(id("https://www.linkedin.com/jobs/view/senior-engineer-at-acme-3912345678?refId=x#frag")).toBe(
    "linkedin:3912345678",
  )
  expect(id("https://www.linkedin.com/comm/jobs/search?currentJobId=3912345678&trk=eml")).toBe("linkedin:3912345678")
  expect(id("https://jobs.lever.co/acme/abc-123/?lever-source=email&utm_source=x")).toBe(
    "url:jobs.lever.co/acme/abc-123",
  )
  expect(id("https://jobs.lever.co/acme/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0?lever-source=email")).toBe(
    "lever:acme:0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
  )
  expect(id("https://www.Acme.dev/careers/1?utm_medium=email&b=2&a=1")).toBe("url:acme.dev/careers/1?a=1&b=2")
  expect(id("https://email.mailer.example/ls/click?upn=1")).toBe("unresolved")
  expect(id("https://tracker.example/r?url=https%3A%2F%2Fjobs.acme.dev%2F42%3Futm_source%3Dx")).toBe(
    "url:jobs.acme.dev/42",
  )
  expect(id("ftp://x.example/1")).toBeUndefined()
  expect(id("javascript:alert(1)")).toBeUndefined()
})

test("senders: validated, normalized and matched on the real address", () => {
  expect(normalizeSender(" Jobs@Site.COM ")).toBe("jobs@site.com")
  expect(normalizeSender("site.com")).toBe("@site.com")
  for (const bad of ["", "a b@site.com", "x@site", "a@b.com OR from:c", '"x"@site.com', "a@b.com)", "-x@site.com"])
    expect(normalizeSender(bad), bad).toBeNull()
  expect(buildQuery(["jobs@site.com", "@other.com"], 14)).toBe(
    "is:unread in:inbox from:(jobs@site.com OR other.com) newer_than:14d",
  )
  expect(fromAddress('"Jobs <jobs@site.com>" <evil@x.example>')).toBe("evil@x.example")
  expect(fromAddress("<a@x.example>, <jobs@linkedin.com>")).toBeNull()
  expect(fromAddress('"Doe, Jo" <jobs@linkedin.com>')).toBe("jobs@linkedin.com")
  expect(isWatched("evil@x.example", ["jobs@site.com"])).toBe(false)
  expect(isWatched("anyone@mail.other.com", ["@other.com"])).toBe(true)
  expect(isWatched("anyone@notother.com", ["@other.com"])).toBe(false)
  expect([
    providerOf("a@jobalerts.linkedin.com"),
    providerOf("a@indeed.com"),
    providerOf("a@linkedin.com.evil.test"),
  ]).toEqual(["linkedin", "indeed", "other"])
})

const randomKey = (seed: number) =>
  Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 7 + seed) % 256)).toString("base64")

test("sealed values open only with the key and the owner they were sealed for", () => {
  const key = parseKey(randomKey(7))
  const sealed = seal(key, "refresh-token-value", "ana")
  expect(sealed).not.toContain("refresh-token-value")
  expect(open(key, sealed, "ana")).toBe("refresh-token-value")
  expect(seal(key, "refresh-token-value", "ana")).not.toBe(sealed)
  expect(() => open(key, sealed, "ben")).toThrow()
  expect(() => open(parseKey(randomKey(8)), sealed, "ana")).toThrow()
  expect(() => open(key, `${sealed}x`, "ana")).toThrow()
})

test("a key that is not 32 random bytes of strict base64 is refused", () => {
  for (const weak of [
    Buffer.alloc(32).toString("base64"),
    "A".repeat(43),
    "correct horse battery staple correct",
    "short",
  ])
    expect(() => parseKey(weak), weak).toThrow()
  expect(parseKey(randomKey(1))).toHaveLength(32)
})
