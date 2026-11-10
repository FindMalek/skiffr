import { and, cosineDistance, eq, isNotNull, ne, sql } from "drizzle-orm"
import type { Db } from "./index"
import { answer, answerColumns } from "./schema"

/** The user's answers nearest to `embedding` by cosine distance, closest first. Exact on purpose: an hnsw index post-filters on user_id and returns short or empty results. Rows without an embedding and rejected ones are skipped. */
export function findSimilarAnswers(db: Db, userId: string, embedding: number[], limit: number) {
  const distance = sql<number>`${cosineDistance(answer.embedding, embedding)}`
  return db
    .select({ ...answerColumns, distance })
    .from(answer)
    .where(and(eq(answer.userId, userId), isNotNull(answer.embedding), ne(answer.status, "rejected")))
    .orderBy(distance)
    .limit(limit)
}
