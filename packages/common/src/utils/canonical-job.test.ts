import { expect, test } from "bun:test"
import { atsFromCanonicalId, canonicalizeJob, canonicalJobId, JOB_VENDORS } from "./canonical-job"
import { sha256Hex } from "./sha256"

/**
 * One row per link: what id it must get. Rows of one posting share an id; the rows of different postings, and of hostile
 * look-alikes, must not. This is the single helper for the dashboard, the api and the Gmail connector.
 */
const MATRIX: Array<[url: string, id: string]> = [
  // li same
  ["https://www.linkedin.com/jobs/view/3912345678", "linkedin:3912345678"],
  ["https://linkedin.com/jobs/view/3912345678/", "linkedin:3912345678"],
  ["https://uk.linkedin.com/jobs/view/3912345678?trk=abc", "linkedin:3912345678"],
  ["https://www.linkedin.com/comm/jobs/view/3912345678?trackingId=xx&refId=y", "linkedin:3912345678"],
  ["https://www.linkedin.com/jobs/view/senior-engineer-at-acme-3912345678", "linkedin:3912345678"],
  ["https://www.linkedin.com/jobs/search/?currentJobId=3912345678&keywords=x", "linkedin:3912345678"],
  ["https://www.linkedin.com/jobs/collections/recommended/?currentJobId=3912345678", "linkedin:3912345678"],
  ["https://de.linkedin.com/jobs/view/senior-engineer-at-acme-3912345678?position=1&pageNum=0", "linkedin:3912345678"],
  ["https://www.linkedin.com/jobs/view/3912345678#x", "linkedin:3912345678"],
  ["https://m.linkedin.com/jobs/view/3912345678", "linkedin:3912345678"],
  ["https://www.linkedin.com/jobs/view/3912345678/apply", "linkedin:3912345678"],
  // li other
  ["https://www.linkedin.com/jobs/view/3912345679", "linkedin:3912345679"],
  // indeed same
  ["https://www.indeed.com/viewjob?jk=abcdef0123456789", "indeed:abcdef0123456789"],
  ["https://indeed.com/viewjob?jk=ABCDEF0123456789&utm_source=x", "indeed:abcdef0123456789"],
  ["https://www.indeed.com/jobs?q=eng&vjk=abcdef0123456789", "indeed:abcdef0123456789"],
  ["https://www.indeed.com/rc/clk?jk=abcdef0123456789&fccid=1", "indeed:abcdef0123456789"],
  ["https://ca.indeed.com/viewjob?jk=abcdef0123456789", "indeed:abcdef0123456789"],
  ["https://uk.indeed.com/viewjob?jk=abcdef0123456789", "indeed:abcdef0123456789"],
  ["https://www.indeed.co.uk/viewjob?jk=abcdef0123456789", "indeed:abcdef0123456789"],
  ["https://m.indeed.com/viewjob?jk=abcdef0123456789", "indeed:abcdef0123456789"],
  // gh same
  ["https://boards.greenhouse.io/acme/jobs/4012345", "greenhouse:acme:4012345"],
  ["https://job-boards.greenhouse.io/acme/jobs/4012345", "greenhouse:acme:4012345"],
  ["https://boards.greenhouse.io/Acme/jobs/4012345?gh_src=abc", "greenhouse:acme:4012345"],
  ["https://boards.greenhouse.io/acme/jobs/4012345/", "greenhouse:acme:4012345"],
  ["https://job-boards.greenhouse.io/acme/jobs/4012345#app", "greenhouse:acme:4012345"],
  ["https://boards.greenhouse.io/embed/job_app?for=acme&token=4012345", "greenhouse:acme:4012345"],
  ["https://boards.eu.greenhouse.io/acme/jobs/4012345", "greenhouse:acme:4012345"],
  ["https://boards.greenhouse.io/acme/jobs/4012345?gh_jid=4012345", "greenhouse:acme:4012345"],
  // gh other company
  ["https://boards.greenhouse.io/beta/jobs/4012345", "greenhouse:beta:4012345"],
  // gh careers page gh_jid
  ["https://careers.acme.com/open-roles?gh_jid=4012345", "url:careers.acme.com/open-roles?gh_jid=4012345"],
  ["https://www.acme.com/careers/job?gh_jid=4012345", "url:acme.com/careers/job?gh_jid=4012345"],
  ["https://acme.com/careers/other?gh_jid=4012345", "url:acme.com/careers/other?gh_jid=4012345"],
  // lever same
  [
    "https://jobs.lever.co/acme/123e4567-e89b-12d3-a456-426614174000",
    "lever:acme:123e4567-e89b-12d3-a456-426614174000",
  ],
  [
    "https://jobs.lever.co/acme/123e4567-e89b-12d3-a456-426614174000/apply",
    "lever:acme:123e4567-e89b-12d3-a456-426614174000",
  ],
  [
    "https://jobs.lever.co/Acme/123E4567-E89B-12D3-A456-426614174000?lever-source=x",
    "lever:acme:123e4567-e89b-12d3-a456-426614174000",
  ],
  [
    "https://jobs.eu.lever.co/acme/123e4567-e89b-12d3-a456-426614174000",
    "lever:acme:123e4567-e89b-12d3-a456-426614174000",
  ],
  // lever other co
  [
    "https://jobs.lever.co/beta/123e4567-e89b-12d3-a456-426614174000",
    "lever:beta:123e4567-e89b-12d3-a456-426614174000",
  ],
  // ashby
  [
    "https://jobs.ashbyhq.com/acme/123e4567-e89b-12d3-a456-426614174000",
    "ashby:acme:123e4567-e89b-12d3-a456-426614174000",
  ],
  [
    "https://jobs.ashbyhq.com/acme/123e4567-e89b-12d3-a456-426614174000/application",
    "ashby:acme:123e4567-e89b-12d3-a456-426614174000",
  ],
  [
    "https://jobs.ashbyhq.com/acme/123e4567-e89b-12d3-a456-426614174000?utm_source=x",
    "ashby:acme:123e4567-e89b-12d3-a456-426614174000",
  ],
  [
    "https://jobs.ashbyhq.com/acme?ashby_jid=123e4567-e89b-12d3-a456-426614174000",
    "ashby:acme:123e4567-e89b-12d3-a456-426614174000",
  ],
  [
    "https://jobs.ashbyhq.com/acme/jobs/123e4567-e89b-12d3-a456-426614174000",
    "url:jobs.ashbyhq.com/acme/jobs/123e4567-e89b-12d3-a456-426614174000",
  ],
  // workable
  ["https://apply.workable.com/acme/j/ABC123DEF4/", "workable:acme:abc123def4"],
  ["https://apply.workable.com/acme/j/abc123def4/apply/", "workable:acme:abc123def4"],
  ["https://apply.workable.com/acme/j/ABC123DEF4?utm_source=x", "workable:acme:abc123def4"],
  ["https://acme.workable.com/jobs/12345", "workable:acme:12345"],
  // workday
  [
    "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Remote/Senior-Engineer_R12345",
    "url:acme.wd5.myworkdayjobs.com/en-US/External/job/Remote/Senior-Engineer_R12345",
  ],
  [
    "https://acme.wd5.myworkdayjobs.com/External/job/Remote/Senior-Engineer_R12345/apply",
    "url:acme.wd5.myworkdayjobs.com/External/job/Remote/Senior-Engineer_R12345/apply",
  ],
  [
    "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Remote/Senior-Engineer_R12345?source=LinkedIn",
    "url:acme.wd5.myworkdayjobs.com/en-US/External/job/Remote/Senior-Engineer_R12345?source=LinkedIn",
  ],
  [
    "https://acme.wd5.myworkdayjobs.com/en-US/External/job/NYC/Senior-Engineer_R12345-1",
    "url:acme.wd5.myworkdayjobs.com/en-US/External/job/NYC/Senior-Engineer_R12345-1",
  ],
  // smartrecruiters
  [
    "https://jobs.smartrecruiters.com/Acme/743999912345678-senior-engineer",
    "url:jobs.smartrecruiters.com/Acme/743999912345678-senior-engineer",
  ],
  ["https://jobs.smartrecruiters.com/Acme/743999912345678", "url:jobs.smartrecruiters.com/Acme/743999912345678"],
  [
    "https://jobs.smartrecruiters.com/oneclick-ui/company/Acme/publication/abcd-1234",
    "url:jobs.smartrecruiters.com/oneclick-ui/company/Acme/publication/abcd-1234",
  ],
  // teamtailor
  ["https://acme.teamtailor.com/jobs/1234567-senior-engineer", "url:acme.teamtailor.com/jobs/1234567-senior-engineer"],
  [
    "https://acme.teamtailor.com/jobs/1234567-senior-engineer?promotion=1",
    "url:acme.teamtailor.com/jobs/1234567-senior-engineer?promotion=1",
  ],
  [
    "https://career.acme.com/jobs/1234567-senior-engineer?utm_source=x",
    "url:career.acme.com/jobs/1234567-senior-engineer",
  ],
  // generic tracking
  ["https://example.com/careers/42", "url:example.com/careers/42"],
  ["https://www.example.com/careers/42/", "url:example.com/careers/42"],
  ["https://EXAMPLE.com/careers/42?utm_source=a&gclid=b&fbclid=c&ref=d#frag", "url:example.com/careers/42?ref=d"],
  ["https://example.com:443/careers/42", "url:example.com/careers/42"],
  ["http://example.com/careers/42", "url:example.com/careers/42"],
  ["https://example.com/careers/42?", "url:example.com/careers/42"],
  ["https://example.com//careers/42", "url:example.com//careers/42"],
  // generic jobid param
  ["https://example.com/job?id=1", "url:example.com/job?id=1"],
  ["https://example.com/job?id=2", "url:example.com/job?id=2"],
  ["https://example.com/job?ref=1", "url:example.com/job?ref=1"],
  ["https://example.com/job?ref=2", "url:example.com/job?ref=2"],
  ["https://example.com/job?source=1", "url:example.com/job?source=1"],
  ["https://example.com/job?src=2", "url:example.com/job?src=2"],
  ["https://example.com/job?cid=1", "url:example.com/job?cid=1"],
  ["https://example.com/job?cid=2", "url:example.com/job?cid=2"],
  ["https://example.com/job?campaign=1", "url:example.com/job?campaign=1"],
  ["https://example.com/job?campaign=2", "url:example.com/job?campaign=2"],
  ["https://example.com/job?trk=1", "url:example.com/job"],
  ["https://example.com/job?referral=a", "url:example.com/job?referral=a"],
  ["https://example.com/job?referral=b", "url:example.com/job?referral=b"],
  ["https://example.com/job?refid=1", "url:example.com/job?refid=1"],
  ["https://example.com/job?refid=2", "url:example.com/job?refid=2"],
  ["https://example.com/careers?jobId=1", "url:example.com/careers?jobId=1"],
  ["https://example.com/careers?jobId=2", "url:example.com/careers?jobId=2"],
  ["https://example.com/careers?jobId=1&jobId=2", "url:example.com/careers?jobId=1&jobId=2"],
  // ordering/dups
  ["https://example.com/j?a=1&b=2", "url:example.com/j?a=1&b=2"],
  ["https://example.com/j?b=2&a=1", "url:example.com/j?a=1&b=2"],
  ["https://example.com/j?a=1&a=2", "url:example.com/j?a=1&a=2"],
  ["https://example.com/j?a=2&a=1", "url:example.com/j?a=1&a=2"],
  ["https://example.com/j?a=1&a=1", "url:example.com/j?a=1&a=1"],
  // encoding
  ["https://example.com/jobs/caf%C3%A9", "url:example.com/jobs/caf%C3%A9"],
  ["https://example.com/jobs/café", "url:example.com/jobs/caf%C3%A9"],
  ["https://example.com/jobs/caf%c3%a9", "url:example.com/jobs/caf%C3%A9"],
  ["https://example.com/jobs/a%2Fb", "url:example.com/jobs/a%2Fb"],
  ["https://example.com/jobs/a/b", "url:example.com/jobs/a/b"],
  ["https://example.com/jobs/a%20b", "url:example.com/jobs/a%20b"],
  ["https://example.com/jobs/a+b", "url:example.com/jobs/a+b"],
  ["https://example.com/j?q=a%20b", "url:example.com/j?q=a+b"],
  ["https://example.com/j?q=a+b", "url:example.com/j?q=a+b"],
  ["https://example.com/j?q=a%2Bb", "url:example.com/j?q=a%2Bb"],
  ["https://example.com/J", "url:example.com/J"],
  ["https://example.com/j", "url:example.com/j"],
  // idn
  ["https://münchen.de/jobs/1", "url:xn--mnchen-3ya.de/jobs/1"],
  ["https://xn--mnchen-3ya.de/jobs/1", "url:xn--mnchen-3ya.de/jobs/1"],
  ["https://MÜNCHEN.de/jobs/1", "url:xn--mnchen-3ya.de/jobs/1"],
  ["https://example.com./jobs/1", "url:example.com/jobs/1"],
  ["https://example.com/jobs/1", "url:example.com/jobs/1"],
  // ports
  ["https://example.com:8443/j", "url:example.com:8443/j"],
  ["https://example.com/j", "url:example.com/j"],
  ["https://example.com:8080/j", "url:example.com:8080/j"],
  ["http://example.com:80/j", "url:example.com/j"],
  ["https://example.com:80/j", "url:example.com:80/j"],
  // case path
  ["https://example.com/Jobs/ABC", "url:example.com/Jobs/ABC"],
  ["https://example.com/jobs/abc", "url:example.com/jobs/abc"],
  // unusual
  ["not a url", "url:not a url"],
  ["NOT A URL", "url:not a url"],
  ["  https://example.com/x  ", "url:example.com/x"],
  ["https://user:pw@example.com/x", "url:example.com/x"],
  ["https://example.com/x?gh_jid=123", "url:example.com/x?gh_jid=123"],
  ["https://other.com/x?gh_jid=123", "url:other.com/x?gh_jid=123"],
  ["https://www.example.com/x?gh_jid=123", "url:example.com/x?gh_jid=123"],
  // linkedin edge
  ["https://www.linkedin.com/jobs/view/senior-eng-12", "url:linkedin.com/jobs/view/senior-eng-12"],
  [
    "https://www.linkedin.com/jobs/view/1234567890123456789012345678901234567890",
    "url:linkedin.com/jobs/view/1234567890123456789012345678901234567890",
  ],
  ["https://www.linkedin.com/jobs/search/?currentJobId=abc", "url:linkedin.com/jobs/search?currentJobId=abc"],
  ["https://www.linkedin.com/jobs/view/3912345678abc", "url:linkedin.com/jobs/view/3912345678abc"],
  [
    "https://www.linkedin.com/in/john-1234567890/jobs/view/5555555555",
    "url:linkedin.com/in/john-1234567890/jobs/view/5555555555",
  ],
  ["https://www.linkedin.com/company/acme-1234567/jobs/", "url:linkedin.com/company/acme-1234567/jobs"],
  ["https://www.linkedin.com/posts/x?currentJobId=3912345678", "url:linkedin.com/posts/x?currentJobId=3912345678"],
  ["https://notlinkedin.com/jobs/view/3912345678", "url:notlinkedin.com/jobs/view/3912345678"],
  ["https://linkedin.com.evil.com/jobs/view/3912345678", "url:linkedin.com.evil.com/jobs/view/3912345678"],
  ["https://evilgreenhouse.io/acme/jobs/1", "url:evilgreenhouse.io/acme/jobs/1"],
  ["https://greenhouse.io.evil.com/acme/jobs/1", "url:greenhouse.io.evil.com/acme/jobs/1"],
  // indeed edge
  ["https://www.indeed.com/viewjob?jk=abc", "url:indeed.com/viewjob?jk=abc"],
  ["https://www.indeed.com/viewjob?jk=zzzzzzzzzzzz", "url:indeed.com/viewjob?jk=zzzzzzzzzzzz"],
  ["https://www.indeed.com/jobs?q=x&l=y", "url:indeed.com/jobs?l=y&q=x"],
  ["https://www.indeed.com/cmp/Acme/jobs?jk=abcdef0123456789", "indeed:abcdef0123456789"],
  ["https://www.indeed.com/viewjob?jk=abcdef0123456789&vjk=1111111111111111", "indeed:abcdef0123456789"],
  ["https://www.indeed.com/jobs?vjk=abcdef0123456789&jk=1111111111111111", "indeed:1111111111111111"],
  ["https://notindeed.com/viewjob?jk=abcdef0123456789", "url:notindeed.com/viewjob?jk=abcdef0123456789"],
  ["https://indeed.com.evil.io/viewjob?jk=abcdef0123456789", "url:indeed.com.evil.io/viewjob?jk=abcdef0123456789"],
  ["https://www.indeed.co.in/viewjob?jk=abcdef0123456789", "indeed:abcdef0123456789"],
  ["https://www.indeed.com.au/viewjob?jk=abcdef0123456789", "indeed:abcdef0123456789"],
  ["https://au.indeed.com/viewjob?jk=abcdef0123456789", "indeed:abcdef0123456789"],
  ["https://www.indeed.jobs/viewjob?jk=abcdef0123456789", "url:indeed.jobs/viewjob?jk=abcdef0123456789"],
  // pr62 cases
  ["https://www.linkedin.com/jobs/view/senior-engineer-at-acme-3912345678?refId=x#frag", "linkedin:3912345678"],
  ["https://www.linkedin.com/comm/jobs/search?currentJobId=3912345678&trk=eml", "linkedin:3912345678"],
  ["https://jobs.lever.co/acme/abc-123/?lever-source=email&utm_source=x", "url:jobs.lever.co/acme/abc-123"],
  ["https://www.Acme.dev/careers/1?utm_medium=email&b=2&a=1", "url:acme.dev/careers/1?a=1&b=2"],
  ["https://boards.greenhouse.io/startupco/jobs/4455667?gh_jid=4455667", "greenhouse:startupco:4455667"],
  ["https://www.indeed.com/viewjob?jk=a1b2c3d4e5f60718", "indeed:a1b2c3d4e5f60718"],
  ["https://wellfound.com/jobs/3456789-staff-engineer", "wellfound:3456789"],
  ["https://angel.co/company/hooli/jobs/3456789-staff-engineer", "wellfound:3456789"],
  ["https://www.glassdoor.com/job-listing/j?jl=1009876543", "glassdoor:1009876543"],
  ["https://www.glassdoor.co.uk/partner/jobListing.htm?jobListingId=1009876543", "glassdoor:1009876543"],
  ["ftp://x.example/1", "url:ftp://x.example/1"],
  ["javascript:alert(1)", "url:javascript:alert(1)"],
  // spoofs
  ["https://indeed.xyz/viewjob?jk=abcdef0123456789", "url:indeed.xyz/viewjob?jk=abcdef0123456789"],
  [
    "https://linkedin.com/safety/go?url=https%3A%2F%2Fexample.com&currentJobId=3912345678",
    "url:linkedin.com/safety/go?currentJobId=3912345678&url=https%3A%2F%2Fexample.com",
  ],
  ["https://www.linkedin.com/redirect?currentJobId=3912345678", "url:linkedin.com/redirect?currentJobId=3912345678"],
  ["https://evil.com/linkedin.com/jobs/view/3912345678", "url:evil.com/linkedin.com/jobs/view/3912345678"],
  ["https://indeed.com.evil.io/viewjob?jk=abcdef0123456789", "url:indeed.com.evil.io/viewjob?jk=abcdef0123456789"],
  ["https://xn--linkedn-4ya.com/jobs/view/3912345678", "url:xn--linkedn-4ya.com/jobs/view/3912345678"],
  ["https://boards.greenhouse.io.evil.com/acme/jobs/1", "url:boards.greenhouse.io.evil.com/acme/jobs/1"],
  ["https://boards.evil.greenhouse.io/acme/jobs/1", "url:boards.evil.greenhouse.io/acme/jobs/1"],
  ["https://www.linkedin.com:8443/jobs/view/3912345678", "url:linkedin.com:8443/jobs/view/3912345678"],
  [
    "https://jobs.lever.co.evil.com/acme/123e4567-e89b-12d3-a456-426614174000",
    "url:jobs.lever.co.evil.com/acme/123e4567-e89b-12d3-a456-426614174000",
  ],
  ["https://evil.workable.com.evil.io/jobs/12345", "url:evil.workable.com.evil.io/jobs/12345"],
  ["https://apply.workable.com.evil.io/acme/j/ABC123DEF4", "url:apply.workable.com.evil.io/acme/j/ABC123DEF4"],
  ["https://www.glassdoor.evil.com/job-listing/j?jl=1009876543", "url:glassdoor.evil.com/job-listing/j?jl=1009876543"],
  ["https://wellfound.com.evil.io/jobs/3456789", "url:wellfound.com.evil.io/jobs/3456789"],
  ["https://indeed.com.evil.io@example.com/x", "url:example.com/x"],
  // fragments
  ["https://careers.example.com/#/job/1", "url:careers.example.com#/job/1"],
  ["https://careers.example.com/#/job/2", "url:careers.example.com#/job/2"],
  ["https://careers.example.com/#!/jobs/555", "url:careers.example.com#!/jobs/555"],
  ["https://careers.example.com/#!/jobs/556", "url:careers.example.com#!/jobs/556"],
  ["https://careers.example.com/jobs#apply", "url:careers.example.com/jobs"],
  ["https://careers.example.com/jobs#top", "url:careers.example.com/jobs"],
  ["https://careers.example.com/jobs", "url:careers.example.com/jobs"],
  // tracking list
  ["https://example.com/j?utm_campaign=a", "url:example.com/j"],
  ["https://example.com/j?gclid=1&dclid=2&fbclid=3&msclkid=4&yclid=5&igshid=6", "url:example.com/j"],
  ["https://example.com/j?mc_cid=1&mc_eid=2&_ga=3&_gl=4&_hsenc=5&_hsmi=6&mkt_tok=7", "url:example.com/j"],
  ["https://example.com/j?trk=1&trkInfo=2&gh_src=3&lever-source=4&lever-origin=5", "url:example.com/j"],
  ["https://example.com/j?ref=JOB-1", "url:example.com/j?ref=JOB-1"],
  ["https://example.com/j?ref=JOB-2", "url:example.com/j?ref=JOB-2"],
  ["https://example.com/j?source=a1", "url:example.com/j?source=a1"],
  ["https://example.com/j?src=a1", "url:example.com/j?src=a1"],
  ["https://example.com/j?cid=1", "url:example.com/j?cid=1"],
  ["https://example.com/j?campaign=x", "url:example.com/j?campaign=x"],
  ["https://example.com/j?trackingid=1", "url:example.com/j?trackingid=1"],
  ["https://example.com/j?from=alert", "url:example.com/j?from=alert"],
  ["https://example.com/j?tk=1", "url:example.com/j?tk=1"],
]

test("every link in the matrix gets its id", () => {
  expect(MATRIX.length).toBeGreaterThan(140)
  for (const [url, id] of MATRIX) expect(canonicalJobId(url), url).toBe(id)
})

const id = canonicalJobId

test("a client route in the fragment is part of the id, a plain anchor is not", () => {
  expect(id("https://careers.example.com/#/job/1")).not.toBe(id("https://careers.example.com/#/job/2"))
  expect(id("https://careers.example.com/#!/jobs/555")).not.toBe(id("https://careers.example.com/#!/jobs/556"))
  expect(id("https://careers.example.com/jobs#apply")).toBe(id("https://careers.example.com/jobs"))
})

test("only parameters that are always tracking are dropped: ref, source, src, cid, campaign can be job ids", () => {
  for (const name of ["ref", "source", "src", "cid", "campaign", "referral", "refid", "trackingid"]) {
    expect(id(`https://example.com/j?${name}=JOB-1`), name).not.toBe(id(`https://example.com/j?${name}=JOB-2`))
  }
  for (const name of [
    "utm_source",
    "gclid",
    "fbclid",
    "msclkid",
    "mc_cid",
    "mc_eid",
    "_ga",
    "_gl",
    "trk",
    "trkInfo",
    "gh_src",
    "lever-source",
    "lever-origin",
  ]) {
    expect(id(`https://example.com/j?${name}=x`), name).toBe(id("https://example.com/j"))
  }
})

test("a long id is the first 128 bits of a sha256, so a crafted link can't be matched to another by collision", () => {
  const long = `https://example.com/${"a".repeat(400)}`
  const key = `example.com/${"a".repeat(400)}`
  expect(id(long)).toBe(`url:${sha256Hex(key).slice(0, 32)}`)
  expect(id(long)).not.toBe(id(`${long}b`))
  expect(id(long)).toBe(id(`${long}?utm_source=z`))
  for (const url of [long, `https://example.com/${"é".repeat(300)}`, `https://example.com/?${"q=1&".repeat(200)}`]) {
    expect(id(url).length).toBeLessThanOrEqual(200)
  }
})

test("a vendor id needs the vendor's own host: look-alikes, ports and wrong paths stay ordinary url ids", () => {
  const spoofs = [
    "https://indeed.xyz/viewjob?jk=abcdef0123456789",
    "https://indeed.com.evil.io/viewjob?jk=abcdef0123456789",
    "https://www.indeed.jobs/viewjob?jk=abcdef0123456789",
    "https://linkedin.com/safety/go?url=https%3A%2F%2Fexample.com&currentJobId=3912345678",
    "https://www.linkedin.com/posts/x?currentJobId=3912345678",
    "https://linkedin.com.evil.com/jobs/view/3912345678",
    "https://evil.com/linkedin.com/jobs/view/3912345678",
    "https://xn--linkedn-4ya.com/jobs/view/3912345678",
    "https://www.linkedin.com:8443/jobs/view/3912345678",
    "https://boards.greenhouse.io.evil.com/acme/jobs/1",
    "https://jobs.lever.co.evil.com/acme/123e4567-e89b-12d3-a456-426614174000",
    "https://apply.workable.com.evil.io/acme/j/ABC123DEF4",
    "https://wellfound.com.evil.io/jobs/3456789",
  ]
  for (const url of spoofs) {
    const job = canonicalizeJob(url)
    expect(job.vendor, url).toBeNull()
    expect(job.canonicalId, url).toStartWith("url:")
    expect(job.url, url).toBe(url)
  }
})

test("a vendor link is stored as the vendor's clean link, never the caller's", () => {
  const clean = (url: string) => canonicalizeJob(url).url
  expect(clean("https://uk.linkedin.com/comm/jobs/view/senior-3912345678/?trackingId=x&refId=y&trk=eml")).toBe(
    "https://www.linkedin.com/jobs/view/3912345678",
  )
  expect(clean("https://ca.indeed.com/viewjob?jk=ABCDEF0123456789&mkt_tok=secret&from=email")).toBe(
    "https://www.indeed.com/viewjob?jk=abcdef0123456789",
  )
  expect(clean("https://boards.eu.greenhouse.io/Acme/jobs/4012345?gh_src=x")).toBe(
    "https://job-boards.greenhouse.io/acme/jobs/4012345",
  )
  expect(clean("https://jobs.eu.lever.co/Acme/123E4567-E89B-12D3-A456-426614174000/apply?lever-source=x")).toBe(
    "https://jobs.lever.co/acme/123e4567-e89b-12d3-a456-426614174000",
  )
  expect(clean("https://jobs.ashbyhq.com/acme?ashby_jid=123E4567-E89B-12D3-A456-426614174000")).toBe(
    "https://jobs.ashbyhq.com/acme/123e4567-e89b-12d3-a456-426614174000",
  )
  expect(clean("https://apply.workable.com/Acme/j/abc123def4/apply/")).toBe(
    "https://apply.workable.com/acme/j/ABC123DEF4/",
  )
  expect(clean("https://www.glassdoor.co.uk/partner/jobListing.htm?jobListingId=1009876543&utm_source=x")).toBe(
    "https://www.glassdoor.com/job-listing/j?jl=1009876543",
  )
  expect(clean("https://angel.co/company/hooli/jobs/3456789-staff-engineer?ref=x")).toBe(
    "https://wellfound.com/jobs/3456789",
  )
  expect(clean("  https://example.com/careers/1?utm_source=x  ")).toBe("https://example.com/careers/1?utm_source=x")
})

test("indeed's country domains are matched from an explicit list", () => {
  for (const host of [
    "indeed.com",
    "uk.indeed.com",
    "www.indeed.co.uk",
    "indeed.com.au",
    "www.indeed.co.in",
    "indeed.fr",
    "de.indeed.com",
    "indeed.ca",
    "indeed.com.br",
    "www.indeed.co.jp",
    "indeed.com.sg",
  ]) {
    expect(id(`https://${host}/viewjob?jk=abcdef0123456789`), host).toBe("indeed:abcdef0123456789")
  }
  for (const host of [
    "indeed.xyz",
    "indeed.co",
    "indeed.cc",
    "indeed.zz",
    "notindeed.com",
    "indeed.com.evil.io",
    "indeed.co.uk.evil.io",
    "indeed.jobs",
  ]) {
    expect(id(`https://${host}/viewjob?jk=abcdef0123456789`), host).toStartWith("url:")
  }
})

test("the supported vendors are documented and every vendor id prefix is one of them", () => {
  expect(JOB_VENDORS.map((v) => v.id).sort()).toEqual([
    "ashby",
    "glassdoor",
    "greenhouse",
    "indeed",
    "lever",
    "linkedin",
    "wellfound",
    "workable",
  ])
  const prefixes = new Set(MATRIX.map(([, value]) => value.split(":")[0]!))
  for (const prefix of prefixes) expect(["url", ...JOB_VENDORS.map((v) => v.id)]).toContain(prefix)
  expect(atsFromCanonicalId("lever:acme:1")).toBe("lever")
  expect(atsFromCanonicalId("url:acme.dev/jobs")).toBe("other")
  expect(atsFromCanonicalId("acme:1")).toBe("other")
})

test("an unparsable or non-web link still gets a stable id", () => {
  expect(id("not a url")).toBe("url:not a url")
  expect(id("  NOT a URL ")).toBe("url:not a url")
  expect(id("x".repeat(500)).length).toBeLessThanOrEqual(200)
})
