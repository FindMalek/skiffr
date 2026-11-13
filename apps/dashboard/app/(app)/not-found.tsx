import type { Metadata } from "next"
import { ErrorPage, NOT_FOUND } from "@/components/shell/error-page"

export const metadata: Metadata = { title: "Page not found" }

export default function AppNotFound() {
  return <ErrorPage {...NOT_FOUND} />
}
