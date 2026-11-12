import { ORPCError } from "@orpc/server"
import { canonicalizeJob } from "@skiffr/common/utils"
import { type Db, job } from "@skiffr/db"
import { and, eq } from "drizzle-orm"

export type QueuedJob = { url: string; title: string; company: string; source: string }

/**
 * Queues a posting for a user, or returns the one they already have. This is the only place a job's canonical id is
 * made, so every source (dashboard, extension, Gmail, careers pages) dedupes the same way: callers pass a url, never an
 * id. A supported vendor's link is stored as the vendor's clean link, never as the caller wrote it, so a hostile link
 * can't take over a real job's id and keep its own url.
 */
export async function queueJob(db: Pick<Db, "insert" | "select">, userId: string, input: QueuedJob, now: Date) {
  const { canonicalId, url } = canonicalizeJob(input.url)
  // The row can be deleted between the conflict and the read: insert again instead of failing.
  for (let attempt = 0; attempt < 3; attempt++) {
    const [created] = await db
      .insert(job)
      .values({ ...input, url, canonicalId, userId, queuedAt: now })
      .onConflictDoNothing()
      .returning()
    if (created) return { job: created, created: true }
    const [existing] = await db
      .select()
      .from(job)
      .where(and(eq(job.userId, userId), eq(job.canonicalId, canonicalId)))
    if (existing) return { job: existing, created: false }
  }
  throw new ORPCError("CONFLICT", { message: "The job changed while it was saved. Try again." })
}
