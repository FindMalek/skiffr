"use client"

import { type CSSProperties, useSyncExternalStore } from "react"
import { absoluteDate, absoluteTime, type DateInput, DEFAULT_LOCALE, NA, relativeTime, toDate } from "@/lib/format"

type Viewer = { now: number; locale: string; timeZone: string }

const TICK_MS = 60_000

let viewer: Viewer | null = null
let timer: ReturnType<typeof setInterval> | undefined
const listeners = new Set<() => void>()

function readViewer(): Viewer {
  return {
    now: Date.now(),
    locale: navigator.language || DEFAULT_LOCALE,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}

function refresh(): void {
  viewer = readViewer()
  for (const listener of listeners) listener()
}

function onVisibility(): void {
  if (document.hidden) {
    clearInterval(timer)
    timer = undefined
    return
  }
  refresh()
  timer ??= setInterval(refresh, TICK_MS)
}

/** One interval for every `<Time>` on the page, off while the tab is hidden. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", onVisibility)
    if (!document.hidden) timer = setInterval(refresh, TICK_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size > 0) return
    document.removeEventListener("visibilitychange", onVisibility)
    clearInterval(timer)
    timer = undefined
  }
}

function getSnapshot(): Viewer {
  // with no subscriber nothing refreshes the cache, so an old one is replaced instead of shown
  if (!viewer || (listeners.size === 0 && Date.now() - viewer.now > TICK_MS)) viewer = readViewer()
  return viewer
}

const getServerSnapshot = (): Viewer | null => null

const SERVER = { locale: DEFAULT_LOCALE, timeZone: "UTC" } as const

type TimeProps = {
  value: DateInput
  /** `relative` for "2h ago", `absolute` for "3 Nov 2026, 14:05". */
  mode?: "relative" | "absolute"
  /** Absolute mode only: false drops the clock and keeps the date. */
  time?: boolean
  className?: string
}

/**
 * Server markup and the first client render are the same UTC date in `DEFAULT_LOCALE`, so hydration never differs.
 * After hydration it switches to the viewer's locale and zone, and relative text refreshes every minute. The box keeps
 * the server text's width, so the later, shorter text does not move what is next to it.
 */
export function Time({ value, mode = "relative", time = true, className }: TimeProps) {
  const client = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const date = toDate(value)
  if (!date) return <span className={className}>{NA}</span>

  const absolute = mode === "absolute"
  const serverText = absolute && time ? `${absoluteTime(date, SERVER)} UTC` : absoluteDate(date, SERVER)
  const full = client ? absoluteTime(date, client) : `${absoluteTime(date, SERVER)} UTC`
  const text = !client
    ? serverText
    : absolute
      ? absoluteTime(date, { ...client, time })
      : relativeTime(date, client.now, client)

  return (
    <time
      dateTime={date.toISOString()}
      title={absolute ? undefined : full}
      dir="auto"
      className={`inline-block min-w-(--time-width) whitespace-nowrap tabular-nums ${className ?? ""}`.trim()}
      style={{ "--time-width": `${serverText.length}ch` } as CSSProperties}
    >
      {text}
      {absolute ? null : <span className="sr-only">{`, ${full}`}</span>}
    </time>
  )
}

export function RelativeTime(props: Omit<TimeProps, "mode" | "time">) {
  return <Time {...props} mode="relative" />
}
