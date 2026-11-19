"use client"

import { Button } from "@skiffr/ui/components/button"
import Link from "next/link"
import { useEffect, useState } from "react"
import { useDismissed } from "@/components/answers/use-dismissed"
import { countOpenReview, reviewLine } from "@/lib/today"

type Candidate = Parameters<typeof countOpenReview>[0][number]

/**
 * The count runs in the browser because dismissing a keep card is stored here only. Before mount the server cannot
 * know it, so the number waits: showing the wrong one for a moment would be worse than a short line.
 */
export function ReviewLine({ suggestions }: { suggestions: Candidate[] }) {
  const { dismissed } = useDismissed()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const count = countOpenReview(suggestions, dismissed)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p aria-live="polite" className="text-sm tabular-nums">
        {mounted ? reviewLine(count) : "Checking answers."}
      </p>
      {mounted && count > 0 && (
        <Button variant="outline" size="sm" render={<Link href="/answers" />} nativeButton={false}>
          Review answers
        </Button>
      )}
    </div>
  )
}
