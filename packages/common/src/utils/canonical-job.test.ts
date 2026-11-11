import { expect, test } from "bun:test"
import { atsFromCanonicalId, canonicalJobId } from "./canonical-job"

const same = (...urls: string[]) => {
  const ids = urls.map(canonicalJobId)
  for (const id of ids) expect(id).toBe(ids[0]!)
  return ids[0]!
}

test("a vendor's job id wins over the way the link was written", () => {
  expect(
    same(
      "https://www.linkedin.com/jobs/view/senior-engineer-at-acme-3812345678/?trackingId=abc%3D%3D&refId=x&trk=eml",
      "https://uk.linkedin.com/jobs/view/3812345678",
      "https://www.linkedin.com/jobs/collections/recommended/?currentJobId=3812345678",
    ),
  ).toBe("linkedin:3812345678")
  expect(
    same(
      "https://www.indeed.com/viewjob?jk=AB12CD34EF56AB78&from=serp",
      "https://uk.indeed.com/rc/clk?jk=ab12cd34ef56ab78&utm_source=x",
    ),
  ).toBe("indeed:ab12cd34ef56ab78")
  expect(
    same(
      "https://boards.greenhouse.io/Acme/jobs/4012345?gh_src=abc",
      "https://job-boards.greenhouse.io/acme/jobs/4012345/",
      "https://boards.greenhouse.io/embed/job_app?for=acme&token=4012345",
    ),
  ).toBe("greenhouse:acme:4012345")
  expect(
    same(
      "https://jobs.lever.co/acme/5A1B2C3D-0000-4000-8000-123456789abc/apply?lever-source=Gmail",
      "https://jobs.lever.co/acme/5a1b2c3d-0000-4000-8000-123456789abc",
    ),
  ).toBe("lever:acme:5a1b2c3d-0000-4000-8000-123456789abc")
  expect(
    same(
      "https://jobs.ashbyhq.com/acme/5a1b2c3d-0000-4000-8000-123456789abc/application?utm_source=x",
      "https://jobs.ashbyhq.com/Acme/5a1b2c3d-0000-4000-8000-123456789abc",
    ),
  ).toBe("ashby:acme:5a1b2c3d-0000-4000-8000-123456789abc")
  expect(
    same("https://apply.workable.com/acme/j/ABC123DEF4/?ref=x", "https://apply.workable.com/acme/j/abc123def4"),
  ).toBe("workable:acme:abc123def4")
  expect(canonicalJobId("https://careers.acme.dev/open?gh_jid=77&utm_medium=x")).toBe("greenhouse:careers.acme.dev:77")
})

test("other links lose only their fragment, tracking params, www and trailing slash", () => {
  expect(
    same(
      "https://www.Acme.dev/careers/senior/?b=2&a=1&utm_source=x&gclid=1#apply",
      "https://acme.dev/careers/senior?a=1&b=2&ref=newsletter",
    ),
  ).toBe("url:acme.dev/careers/senior?a=1&b=2")
  expect(canonicalJobId("https://acme.dev/Jobs/A")).not.toBe(canonicalJobId("https://acme.dev/jobs/a"))
  expect(canonicalJobId("https://acme.dev/jobs?id=1")).not.toBe(canonicalJobId("https://acme.dev/jobs?id=2"))
})

test("a vendor url without a job id, or a different job, does not collide", () => {
  expect(canonicalJobId("https://www.linkedin.com/jobs/view/1111111111")).not.toBe(
    canonicalJobId("https://www.linkedin.com/jobs/view/2222222222"),
  )
  expect(canonicalJobId("https://www.linkedin.com/company/acme")).toStartWith("url:linkedin.com/company/acme")
  expect(canonicalJobId("https://boards.greenhouse.io/acme")).toStartWith("url:")
})

test("an id never outgrows the column and an unparsable link still gets one", () => {
  const long = canonicalJobId(`https://acme.dev/${"a".repeat(3000)}`)
  expect(long.length).toBeLessThanOrEqual(200)
  expect(long).toBe(canonicalJobId(`https://acme.dev/${"a".repeat(3000)}`))
  expect(long).not.toBe(canonicalJobId(`https://acme.dev/${"a".repeat(2999)}b`))
  expect(canonicalJobId("not a url")).toBe("url:not a url")
})

test("the ats of an application is the vendor in the id, else other", () => {
  expect(atsFromCanonicalId("lever:acme:1")).toBe("lever")
  expect(atsFromCanonicalId("url:acme.dev/jobs")).toBe("other")
  expect(atsFromCanonicalId("acme:1")).toBe("other")
})
