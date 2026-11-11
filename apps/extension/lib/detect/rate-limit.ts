export function createRateLimiter(max: number, windowMs: number, now: () => number = Date.now): () => boolean {
  let stamps: number[] = []
  return () => {
    const time = now()
    stamps = stamps.filter((stamp) => time - stamp < windowMs)
    if (stamps.length >= max) return false
    stamps.push(time)
    return true
  }
}
