"use client"

import { type CSSProperties, type ReactNode, useSyncExternalStore } from "react"
import { absoluteDate, absoluteTime, type DateInput, DEFAULT_LOCALE, NA, relativeTime, toDate } from "@/lib/format"

type Viewer = { locale: string; timeZone: string }

const TICK_MS = 60_000

let viewer: Viewer | null = null
let nowMs = 0
let timer: ReturnType<typeof setInterval> | undefined
const listeners = new Set<() => void>()

function refresh(): void {
  nowMs = Date.now()
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

/** One interval for every relative `<Time>` on the page, off while the tab is hidden. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    nowMs = Date.now() // React re-reads the snapshot after subscribing, so a reading from before this mount is dropped
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

function getNow(): number {
  // with no subscriber nothing refreshes the clock, so an old reading (or one from before the system clock moved) is replaced instead of shown
  if (!nowMs || (listeners.size === 0 && Math.abs(Date.now() - nowMs) > TICK_MS)) nowMs = Date.now()
  return nowMs
}

/** The viewer's locale and zone do not tick, so absolute text never subscribes to the clock. */
const subscribeNever = (): (() => void) => () => {}

function getViewer(): Viewer {
  viewer ??= {
    locale: navigator.language || DEFAULT_LOCALE,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
  return viewer
}

const getServerSnapshot = (): null => null

const SERVER = { locale: DEFAULT_LOCALE, timeZone: "UTC" } as const

type Props = {
  value: DateInput
  /** `relative` for "2h ago", `absolute` for "3 Nov 2026, 14:05". */
  mode?: "relative" | "absolute"
  /** Absolute mode only: false drops the clock and keeps the date. */
  time?: boolean
  className?: string
}

type StampProps = {
  date: Date
  text: string
  serverText: string
  title?: string
  className?: string
  children?: ReactNode
}

/**
 * suppressHydrationWarning: the server text is the UTC date in `DEFAULT_LOCALE`, but month names ("Sep" or "Sept") come
 * from each engine's ICU, so Node and Safari can print different text for the same date. The first client render is
 * replaced by the viewer's own text right after hydration anyway.
 * The box keeps the server text's width, so the later, shorter text does not move what is next to it.
 */
function Stamp({ date, text, serverText, title, className, children }: StampProps) {
  return (
    <time
      dateTime={date.toISOString()}
      title={title}
      dir="auto"
      suppressHydrationWarning
      className={`inline-block min-w-(--time-width) whitespace-nowrap tabular-nums ${className ?? ""}`.trim()}
      style={{ "--time-width": `${serverText.length}ch` } as CSSProperties}
    >
      {text}
      {children}
    </time>
  )
}

function AbsoluteTime({ date, time, className }: { date: Date; time: boolean; className?: string }) {
  const client = useSyncExternalStore(subscribeNever, getViewer, getServerSnapshot)
  const serverText = time ? `${absoluteTime(date, SERVER)} UTC` : absoluteDate(date, SERVER)
  const text = client ? absoluteTime(date, { ...client, time }) : serverText
  return <Stamp date={date} text={text} serverText={serverText} className={className} />
}

function RelativeText({ date, className }: { date: Date; className?: string }) {
  const client = useSyncExternalStore(subscribeNever, getViewer, getServerSnapshot)
  const now = useSyncExternalStore(subscribe, getNow, getServerSnapshot)
  const live = client && now !== null ? { ...client, now } : null
  const full = live ? absoluteTime(date, live) : `${absoluteTime(date, SERVER)} UTC`
  const text = live ? relativeTime(date, live.now, live) : absoluteDate(date, SERVER)
  return (
    <Stamp date={date} text={text} serverText={absoluteDate(date, SERVER)} title={full} className={className}>
      <span className="sr-only" suppressHydrationWarning>
        {`, ${full}`}
      </span>
    </Stamp>
  )
}

/**
 * Server markup and the first client render are the same UTC date in `DEFAULT_LOCALE`. After hydration it switches to
 * the viewer's locale and zone. Only relative text subscribes to the shared minute clock; absolute text never rerenders.
 * An invalid value shows "n/a".
 */
export function Time({ value, mode = "relative", time = true, className }: Props) {
  const date = toDate(value)
  if (!date) return <span className={className}>{NA}</span>
  return mode === "absolute" ? (
    <AbsoluteTime date={date} time={time} className={className} />
  ) : (
    <RelativeText date={date} className={className} />
  )
}

export function RelativeTime(props: Omit<Props, "mode" | "time">) {
  return <Time {...props} mode="relative" />
}
