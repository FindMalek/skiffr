/**
 * One bad request must not take the host down, and a real fault must not hide behind a loop either: a request scoped
 * error is logged as a fixed line (no message, no value that came from a visitor) and the server goes on. Past
 * `maxPerMinute` the process exits, so the platform restarts it clean.
 */
export function installProcessGuards(
  options: { maxPerMinute?: number; log?: (line: string) => void; exit?: (code: number) => void } = {},
): () => void {
  const max = options.maxPerMinute ?? 20
  const log = options.log ?? ((line: string) => console.error(line))
  const exit = options.exit ?? ((code: number) => process.exit(code))
  let times: number[] = []
  const note = (kind: string): void => {
    const now = Date.now()
    times = [...times.filter((at) => now - at < 60_000), now]
    log(`playground: ${kind} caught, still serving`)
    if (times.length > max) exit(1)
  }
  const onException = (): void => note("uncaught exception")
  const onRejection = (): void => note("unhandled rejection")
  process.on("uncaughtException", onException)
  process.on("unhandledRejection", onRejection)
  return () => {
    process.off("uncaughtException", onException)
    process.off("unhandledRejection", onRejection)
  }
}
