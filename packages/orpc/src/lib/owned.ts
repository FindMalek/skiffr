import { ORPCError } from "@orpc/server"
import { and, eq } from "drizzle-orm"
import type { PgColumn } from "drizzle-orm/pg-core"

/** Every update and delete goes through this, so a row is only reachable by its owner. */
export function mine(table: { id: PgColumn; userId: PgColumn }, userId: string, id: string) {
  return and(eq(table.userId, userId), eq(table.id, id))
}

export function orNotFound<T>(row: T | undefined, what: string): T {
  if (!row) throw new ORPCError("NOT_FOUND", { message: `${what} not found.` })
  return row
}
