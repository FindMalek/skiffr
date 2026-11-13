import type { Metadata } from "next"
import { ErrorPage, NOT_FOUND } from "@/components/shell/error-page"

export const metadata: Metadata = { title: "Page not found" }

export default function NotFound() {
  return (
    <main id="main" tabIndex={-1} className="min-h-dvh pt-12 outline-none">
      <ErrorPage {...NOT_FOUND} branded />
    </main>
  )
}
