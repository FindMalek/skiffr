import { and, cosineDistance, eq, isNotNull, sql } from "drizzle-orm"
import type { Db } from "./index"
import { answer, answerColumns } from "./schema"

/** The user's answers nearest to `embedding` by cosine distance, closest first. Rows without an embedding are skipped. */
export function findSimilarAnswers(db: Db, userId: string, embedding: number[], limit: number) {
  const distance = sql<number>`${cosineDistance(answer.embedding, embedding)}`
  return db
    .select({ ...answerColumns, distance })
    .from(answer)
    .where(and(eq(answer.userId, userId), isNotNull(answer.embedding)))
    .orderBy(distance)
    .limit(limit)
}
