"use client"

import { Time } from "@/components/time"

/** Kept for the pages that still import it; `<Time>` is the one implementation. */
export function LocalDate({ value, time = false }: { value: Date; time?: boolean }) {
  return <Time value={value} mode="absolute" time={time} />
}
