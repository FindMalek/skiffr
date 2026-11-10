import { type NextRequest, NextResponse } from "next/server"

/** Optimistic check only (no cookie → sign-in); the api validates the session on every call. */
export function proxy(request: NextRequest) {
  const signedIn =
    request.cookies.has("better-auth.session_token") || request.cookies.has("__Secure-better-auth.session_token")
  if (!signedIn) return NextResponse.redirect(new URL("/sign-in", request.url))
  return NextResponse.next()
}

export const config = { matcher: ["/((?!sign-in|sign-up|api|_next|icon.svg|opengraph-image|robots.txt).*)"] }
