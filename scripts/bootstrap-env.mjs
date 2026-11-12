// The keys scripts/dokploy-bootstrap.mjs may read from --env-file, and what each app gets. Nothing else is read, nothing from the shell.

/** Set on the api app. */
export const API_KEYS = [
  "BETTER_AUTH_SECRET",
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD",
  "EXTENSION_ORIGINS",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_TOKEN",
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GMAIL_ENCRYPTION_KEY",
  "GOOGLE_REDIRECT_URI",
  "GMAIL_SCHEDULER",
  "GMAIL_SYNC_INTERVAL_MINUTES",
  "AI_MODEL",
  "GROQ_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GLITCHTIP_DSN",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_HEADERS",
  "AI_TRACE_CAPTURE_CONTENT",
  "UMAMI_URL",
  "UMAMI_API_WEBSITE_ID",
]

/** Per app, a GlitchTip project of its own. The api's is the plain `GLITCHTIP_DSN`. */
export const GLITCHTIP_DSN_KEYS = {
  web: "GLITCHTIP_WEB_DSN",
  dashboard: "GLITCHTIP_DASHBOARD_DSN",
}

/** One Umami website per app: the env file holds `UMAMI_<APP>_WEBSITE_ID`, the app sees `UMAMI_WEBSITE_ID`. */
export const UMAMI_WEBSITE_KEYS = {
  api: "UMAMI_API_WEBSITE_ID",
  web: "UMAMI_WEB_WEBSITE_ID",
  dashboard: "UMAMI_DASHBOARD_WEBSITE_ID",
  docs: "UMAMI_DOCS_WEBSITE_ID",
}

export const OPTIONAL_KEYS = [
  ...API_KEYS.filter((key) => key !== "UMAMI_API_WEBSITE_ID"),
  ...Object.values(UMAMI_WEBSITE_KEYS),
  ...Object.values(GLITCHTIP_DSN_KEYS),
]

/** What the env file adds to one app. Gmail, ai and secrets go to the api only; every app gets the Umami pair for its own site, and web and dashboard their own GlitchTip dsn. */
export function envForApp(key, extras) {
  const umami = { UMAMI_URL: extras.UMAMI_URL, UMAMI_WEBSITE_ID: extras[UMAMI_WEBSITE_KEYS[key]] }
  const own = key === "api" ? Object.fromEntries(Object.entries(extras).filter(([k]) => API_KEYS.includes(k))) : {}
  delete own.UMAMI_API_WEBSITE_ID
  const dsn = key in GLITCHTIP_DSN_KEYS ? { GLITCHTIP_DSN: extras[GLITCHTIP_DSN_KEYS[key]] } : {}
  return Object.fromEntries(Object.entries({ ...own, ...umami, ...dsn }).filter(([, value]) => value))
}
