/** An in-memory token bucket per key: a burst, then a steady refill. Oldest keys go first when too many are tracked. */
export class RateLimiter {
  #buckets = new Map<string, { tokens: number; at: number }>()
  readonly #burst: number
  readonly #perMinute: number
  readonly #now: () => number
  readonly #maxKeys: number

  constructor(burst: number, perMinute: number, now: () => number = Date.now, maxKeys = 10_000) {
    this.#burst = burst
    this.#perMinute = perMinute
    this.#now = now
    this.#maxKeys = maxKeys
  }

  /** True when the caller may go on; a zero burst turns the limit off. */
  take(key: string): boolean {
    if (this.#burst === 0) return true
    const now = this.#now()
    const bucket = this.#buckets.get(key) ?? { tokens: this.#burst, at: now }
    this.#buckets.delete(key)
    bucket.tokens = Math.min(this.#burst, bucket.tokens + ((now - bucket.at) / 60_000) * this.#perMinute)
    bucket.at = now
    const allowed = bucket.tokens >= 1
    if (allowed) bucket.tokens -= 1
    this.#buckets.set(key, bucket)
    if (this.#buckets.size > this.#maxKeys) this.#buckets.delete(this.#buckets.keys().next().value as string)
    return allowed
  }
}
