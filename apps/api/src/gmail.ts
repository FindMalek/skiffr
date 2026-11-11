import type { Auth } from "@skiffr/auth"
import type { Services } from "@skiffr/orpc"
import {
  authorizeUrl,
  type ConnectReason,
  completeConnect,
  consumeFlow,
  safeReturnTo,
  startFlow,
} from "@skiffr/orpc/gmail"

export const GMAIL_ROUTES = new Set(["/gmail/connect", "/gmail/callback"])

const redirect = (location: string) =>
  new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } })

const refuse = (status: number, message: string) =>
  Response.json({ message }, { status, headers: { "cache-control": "no-store" } })

/**
 * The two plain http routes of the Google consent. Both need the dashboard's cookie session, so they are reached through
 * the dashboard's `/api` proxy (the redirect uri is `<dashboard>/api/gmail/callback`), and a bearer token is refused: Gmail
 * is session only. The answer is always a redirect back to the settings page carrying a fixed status word, never a token
 * or a message from Google. State changes are the callback's single use `state`; disconnecting is an oRPC call with its csrf header.
 */
export async function handleGmail(
  request: Request,
  services: Services & { auth: Auth },
  dashboardUrl: string | undefined,
): Promise<Response> {
  const { pathname, searchParams } = new URL(request.url)
  if (request.method !== "GET") return refuse(405, "Method not allowed.")
  if (request.headers.has("authorization")) return refuse(403, "Gmail is only available to a signed-in session.")
  const gmail = services.gmail
  if (!gmail || !dashboardUrl) return refuse(404, "Gmail import is not configured.")

  const back = (returnTo: string, status: ConnectReason) => {
    const url = new URL(safeReturnTo(returnTo), dashboardUrl)
    url.searchParams.set("gmail", status)
    return redirect(url.href)
  }

  const session = await services.auth.api.getSession({ headers: request.headers }).catch(() => null)
  if (!session) return redirect(new URL("/sign-in", dashboardUrl).href)
  const userId = session.user.id
  const now = services.now()

  if (pathname === "/gmail/connect") {
    const { state, challenge } = await startFlow(
      services.db,
      gmail.runtime.key,
      userId,
      safeReturnTo(searchParams.get("returnTo")),
      now,
    )
    return redirect(authorizeUrl(gmail.runtime, { state, challenge }))
  }

  const flow = await consumeFlow(services.db, gmail.runtime.key, searchParams.get("state") ?? "", userId, now)
  if (!flow) return back("", "invalid_state")
  if (searchParams.has("error"))
    return back(flow.returnTo, searchParams.get("error") === "access_denied" ? "denied" : "google_error")
  const code = searchParams.get("code")
  if (!code) return back(flow.returnTo, "google_error")
  const reason = await completeConnect(services.db, gmail.runtime, { userId, code, verifier: flow.verifier, now })
  return back(flow.returnTo, reason)
}
