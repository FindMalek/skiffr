import type { Metadata } from "next"
import { AppShell } from "@/components/shell/app-shell"
import { ErrorPage, NOT_FOUND } from "@/components/shell/error-page"
import type { ShellUser } from "@/components/shell/user-menu"
import { call } from "@/lib/api"

export const metadata: Metadata = { title: "Page not found" }

/** An unknown url answers a real 404. Signed in it keeps the shell, signed out (or with the api down) it is a plain page. */
async function currentUser(): Promise<ShellUser | null> {
  try {
    return await call((api) => api.me.get())
  } catch {
    return null
  }
}

export default async function NotFound() {
  const me = await currentUser()
  if (me) {
    return (
      <AppShell me={me}>
        <ErrorPage {...NOT_FOUND} />
      </AppShell>
    )
  }
  return (
    <main id="main" tabIndex={-1} className="min-h-dvh pt-12 outline-none">
      <ErrorPage {...NOT_FOUND} branded />
    </main>
  )
}
