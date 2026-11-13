import { type NextRequest, NextResponse } from "next/server"

/** The last path segment has a dot: a file (`/favicon.ico`, `/x.png`, `/.env`). No page of the app looks like that. */
export function isFilePath(pathname: string): boolean {
  return /\.[^/]*$/.test(pathname)
}

/** Optimistic check only (no cookie → sign-in); the api validates the session on every call. */
export function proxy(request: NextRequest) {
  // A file that is not served by the app answers 404 at once, with no session check, no page render and no api call.
  if (isFilePath(request.nextUrl.pathname)) return new NextResponse(null, { status: 404 })
  const signedIn =
    request.cookies.has("better-auth.session_token") || request.cookies.has("__Secure-better-auth.session_token")
  if (!signedIn) return NextResponse.redirect(new URL("/sign-in", request.url))
  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!sign-in|sign-up|api|_next|icon.svg|opengraph-image|robots.txt|analytics\\.js$).*)"],
}
