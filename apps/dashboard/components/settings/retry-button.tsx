"use client"

import { Button } from "@skiffr/ui/components/button"
import { Spinner } from "@skiffr/ui/components/spinner"
import { useRouter } from "next/navigation"
import { useTransition } from "react"

/** Runs the server page again, for a section that failed to load. */
export function RetryButton() {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <Button variant="outline" disabled={pending} onClick={() => start(() => router.refresh())}>
      {pending && <Spinner data-icon="inline-start" />}
      Try again
    </Button>
  )
}
