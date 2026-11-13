import { afterAll, expect, test } from "bun:test"
import { createObservability } from "./observability"
import { ATTRIBUTES } from "./scrub"
import { mockCollector } from "./testing"

const collector = mockCollector()
afterAll(() => collector.stop())

const SECRETS = [
  "Jane Q. Doe",
  "jane.doe@example.com",
  "Why do you want to work here",
  "senior staff payments engineer at Acme",
  "resume: 10 years of Rust",
  "sk-live-0123456789abcdef",
  "Bearer eyJhbGciOi",
]

const hostile = (): Error => {
  const driver = Object.assign(
    new Error(`insert into answer (label, value) values ($1, $2) params: ${SECRETS.join(" | ")}`),
    {
      code: "22021",
      detail: SECRETS[1],
      params: SECRETS,
      query: `select ${SECRETS[0]}`,
    },
  )
  // the fake frame in the message must not become a frame of the report
  const message = `could not save "${SECRETS[2]}" = "${SECRETS[0]}"\n    at evil (/home/${SECRETS[1]}/x.ts:1:1)`
  return Object.assign(new Error(message, { cause: driver }), {
    name: "ValidationError",
    body: { values: SECRETS },
    headers: { authorization: SECRETS[6] },
    status: 500,
  })
}

const dirty = {
  route: "answers.update",
  request_id: "req-1",
  label: SECRETS[2],
  value: SECRETS[0],
  email: SECRETS[1],
  prompt: SECRETS[3],
  resume: SECRETS[4],
  token: SECRETS[5],
  authorization: SECRETS[6],
  job: SECRETS[3],
  error_class: `Bad ${SECRETS[0]}`,
}

test("an error built from form values reports its class and ids, and none of the values leave", async () => {
  const observability = createObservability({
    service: "skiffr-api",
    environment: "test",
    glitchtipDsn: `http://pubkey@${collector.url.replace("http://", "")}/7`,
    otlpEndpoint: `${collector.url}/api/default`,
    umamiUrl: collector.url,
    umamiWebsiteId: "11111111-2222-4333-8444-555555555555",
    flushMs: 0,
  })
  observability.captureError(hostile(), dirty)
  observability.logEvent("error", "failed", dirty)
  observability.count("skiffr.test", 1, dirty)
  observability.track("ai_budget_exhausted", { ...dirty, limit: "daily" })
  await observability.traceAi({ operation: "chat", model: "openai/gpt-oss-120b" }, async (span) => {
    span.record({ inputTokens: 3, outputTokens: 4, prompt: SECRETS, completion: SECRETS })
  })
  await observability.flush()
  await Bun.sleep(20)

  expect(collector.requests.length).toBeGreaterThanOrEqual(4)
  const everything = collector.everything()
  for (const secret of SECRETS) expect(everything).not.toContain(secret)
  expect(everything).not.toContain("Doe")
  expect(everything).not.toContain("authorization")
  expect(everything).toContain("answers.update")
  expect(everything).toContain("ValidationError")
})

test("no key on the allowlist can carry personal data", () => {
  const sensitive =
    /label|value|text|resume|cv|prompt|answer|email|token|password|secret|cookie|header|body|url|query|name$|address|phone|content/i
  for (const key of Object.keys(ATTRIBUTES)) {
    if (key === "error_class") continue
    expect(key).not.toMatch(sensitive)
  }
})
