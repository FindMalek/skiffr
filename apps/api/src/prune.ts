import { type Db, rateLimit } from "@skiffr/db"
import { lt } from "drizzle-orm"

const DAY_MS = 24 * 60 * 60 * 1000

/** better-auth counts per address and path, so requests to made-up paths leave rows that are never read again: drop what is older than any window. */
export async function pruneRateLimits(db: Db, now: Date): Promise<void> {
  await db.delete(rateLimit).where(lt(rateLimit.lastRequest, now.getTime() - DAY_MS))
}
