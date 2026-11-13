import { notFound } from "next/navigation"

/** An unknown url inside the app renders `(app)/not-found.tsx`, so the 404 keeps the shell. */
export default function UnknownPage() {
  notFound()
}
