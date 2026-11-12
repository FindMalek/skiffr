export const LIMIT_CLASSES = ["read", "write", "ai", "expensive"] as const
export type LimitClass = (typeof LIMIT_CLASSES)[number]

/** A bucket holds `burst` calls and gets `perMinute` back every minute. */
export interface BucketRule {
  burst: number
  perMinute: number
}

export type RateRules = Record<LimitClass, BucketRule>

/** Generous for what the dashboard and the extension do on their own, tight where a call costs money or touches the network. */
export const DEFAULT_RATE_RULES: RateRules = {
  read: { burst: 120, perMinute: 600 },
  write: { burst: 60, perMinute: 180 },
  ai: { burst: 10, perMinute: 20 },
  expensive: { burst: 8, perMinute: 12 },
}

export type Verdict = { ok: true } | { ok: false; retryAfterSeconds: number }

const MAP_MAX = 10_000

/** A token bucket per user and class, refilled lazily. Lives in this process only: with several replicas each one counts alone, the daily AI budget in the database is the shared cost control. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>()

  constructor(
    private rules: RateRules = DEFAULT_RATE_RULES,
    private now: () => number = Date.now,
  ) {}

  take(userId: string, limitClass: LimitClass): Verdict {
    const { burst, perMinute } = this.rules[limitClass]
    const perMs = perMinute / 60_000
    const now = this.now()
    const key = `${limitClass}:${userId}`
    const bucket = this.buckets.get(key)
    const tokens = bucket ? Math.min(burst, bucket.tokens + (now - bucket.at) * perMs) : burst
    if (tokens < 1) {
      this.buckets.set(key, { tokens, at: now })
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - tokens) / perMs / 1000)) }
    }
    this.buckets.set(key, { tokens: tokens - 1, at: now })
    if (this.buckets.size > MAP_MAX) this.sweep(now)
    return { ok: true }
  }

  /** Drops the buckets that have refilled completely: forgetting them changes nothing. */
  private sweep(now: number): void {
    for (const [key, bucket] of this.buckets) {
      const rule = this.rules[key.slice(0, key.indexOf(":")) as LimitClass]
      if (bucket.tokens + (now - bucket.at) * (rule.perMinute / 60_000) >= rule.burst) this.buckets.delete(key)
    }
  }
}
