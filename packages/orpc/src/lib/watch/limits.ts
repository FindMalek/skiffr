import { FetchError } from "./errors"

const sleepReal = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const MAP_MAX = 5_000

/** At most one request to a host per `gapMs`: callers queue up for the next free slot, and give up when the slot is past their deadline. */
export class HostGate {
  private next = new Map<string, number>()
  constructor(
    private gapMs: number,
    private sleep: (ms: number) => Promise<void> = sleepReal,
    private now: () => number = Date.now,
  ) {}

  async wait(host: string, deadline: number): Promise<void> {
    const now = this.now()
    if (this.next.size > MAP_MAX) for (const [key, at] of this.next) if (at <= now) this.next.delete(key)
    const at = Math.max(now, this.next.get(host) ?? 0)
    if (at > deadline) throw new FetchError("rate_limited")
    this.next.set(host, at + this.gapMs)
    if (at > now) await this.sleep(at - now)
  }
}

/** A sliding window: a user gets `max` fetches per `windowMs`, whatever started them. */
export class UserBudget {
  private taken = new Map<string, number[]>()
  constructor(
    private max: number,
    private windowMs: number,
  ) {}

  take(userId: string, now: Date): boolean {
    const since = now.getTime() - this.windowMs
    const recent = (this.taken.get(userId) ?? []).filter((at) => at > since)
    if (recent.length >= this.max) {
      this.taken.set(userId, recent)
      return false
    }
    recent.push(now.getTime())
    this.taken.set(userId, recent)
    if (this.taken.size > MAP_MAX)
      for (const [key, list] of this.taken) if (list.every((at) => at <= since)) this.taken.delete(key)
    return true
  }
}
