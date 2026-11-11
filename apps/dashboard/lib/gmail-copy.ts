const NOTICES: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Gmail is connected. skiffr will read your job alerts from now on." },
  denied: { ok: false, text: "You cancelled at Google, so nothing was connected." },
  invalid_state: {
    ok: false,
    text: "That sign-in link expired or was already used. Press Connect Gmail to start again.",
  },
  exchange_failed: { ok: false, text: "Google did not accept the sign-in. Try again." },
  no_refresh_token: { ok: false, text: "Google did not give lasting access. Try again and accept every permission." },
  scope_missing: {
    ok: false,
    text: "The permission to read and tidy your mail was not granted. Try again and tick it.",
  },
  already_connected: { ok: false, text: "That Gmail address is already connected to another skiffr account." },
  not_configured: { ok: false, text: "Gmail import is not set up on this server." },
  google_error: { ok: false, text: "Google could not be reached. Try again in a minute." },
}

const ERRORS: Record<string, string> = {
  auth: "Google no longer accepts the saved access. It was revoked, or expired (Google limits apps in testing mode to 7 days).",
  scope: "The permission to read and tidy your mail is missing.",
  rate_limited: "Google asked skiffr to slow down. It tries again on its own.",
  upstream: "Google had a problem. It tries again on its own.",
  network: "Google could not be reached. It tries again on its own.",
  internal: "Something went wrong on our side. It tries again on its own.",
}

export const noticeFor = (code: string | null) => (code && Object.hasOwn(NOTICES, code) ? NOTICES[code] : undefined)

export const errorFor = (code: string | null) =>
  code && Object.hasOwn(ERRORS, code) ? ERRORS[code] : (ERRORS.internal as string)
