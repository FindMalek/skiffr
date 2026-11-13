import { expect, test } from "bun:test"
import { envForApp, OPTIONAL_KEYS } from "../../../scripts/bootstrap-env.mjs"

const ID = "11111111-2222-4333-8444-555555555555"

test("the deploy bootstrap reads the observability keys from the env file and nothing else new", () => {
  for (const key of [
    "GLITCHTIP_DSN",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_EXPORTER_OTLP_HEADERS",
    "AI_TRACE_CAPTURE_CONTENT",
    "UMAMI_URL",
    "UMAMI_WEB_WEBSITE_ID",
    "UMAMI_DASHBOARD_WEBSITE_ID",
    "UMAMI_DOCS_WEBSITE_ID",
    "UMAMI_API_WEBSITE_ID",
    "GLITCHTIP_WEB_DSN",
    "GLITCHTIP_DASHBOARD_DSN",
  ])
    expect(OPTIONAL_KEYS).toContain(key)
  expect(OPTIONAL_KEYS).not.toContain("DATABASE_URL")
  expect(OPTIONAL_KEYS).not.toContain("UMAMI_WEBSITE_ID")
})

test("the api gets the dsn, the collector and its own umami site, and a frontend gets only umami for its own site", () => {
  const extras = {
    GLITCHTIP_DSN: "https://k@errors.example.com/1",
    OTEL_EXPORTER_OTLP_HEADERS: "authorization=Basic abc",
    UMAMI_URL: "https://analytics.example.com",
    UMAMI_API_WEBSITE_ID: ID,
    UMAMI_WEB_WEBSITE_ID: "22222222-2222-4333-8444-555555555555",
    GROQ_API_KEY: "gsk",
    GLITCHTIP_WEB_DSN: "https://w@errors.example.com/2",
  }
  expect(envForApp("api", extras)).toEqual({
    GLITCHTIP_DSN: extras.GLITCHTIP_DSN,
    OTEL_EXPORTER_OTLP_HEADERS: extras.OTEL_EXPORTER_OTLP_HEADERS,
    UMAMI_URL: extras.UMAMI_URL,
    UMAMI_WEBSITE_ID: ID,
    GROQ_API_KEY: "gsk",
  })
  expect(envForApp("web", extras)).toEqual({
    UMAMI_URL: extras.UMAMI_URL,
    UMAMI_WEBSITE_ID: extras.UMAMI_WEB_WEBSITE_ID,
    GLITCHTIP_DSN: extras.GLITCHTIP_WEB_DSN,
  })
  expect(envForApp("docs", extras)).toEqual({ UMAMI_URL: extras.UMAMI_URL })
  expect(envForApp("dashboard", {})).toEqual({})
})
