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

export interface SimilarHit {
  /** Position of the query vector this hit belongs to. */
  query: number
  id: string
  score: number
}

/** The nearest `limit` answers of the user for every vector in one statement (a lateral join), best first per vector. Same rules as `findSimilarAnswers`. */
export async function findSimilarAnswersMany(
  db: Db,
  userId: string,
  embeddings: number[][],
  limit: number,
): Promise<SimilarHit[]> {
  if (embeddings.length === 0) return []
  const queries = sql.join(
    embeddings.map((embedding, i) => sql`(${i}::int, ${JSON.stringify(embedding)}::vector)`),
    sql`, `,
  )
  const result = await db.execute(sql`
    select q.i as query, a.id as id, a.score as score
    from (values ${queries}) as q(i, v)
    cross join lateral (
      select ${answer.id} as id, 1 - (${answer.embedding} <=> q.v) as score
      from ${answer}
      where ${answer.userId} = ${userId} and ${answer.embedding} is not null and ${answer.status} <> 'rejected'
      order by ${answer.embedding} <=> q.v
      limit ${limit}
    ) a
    order by q.i, a.score desc
  `)
  const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as {
    query: number
    id: string
    score: number | string
  }[]
  return rows.map((row) => ({ query: Number(row.query), id: row.id, score: Number(row.score) }))
}
