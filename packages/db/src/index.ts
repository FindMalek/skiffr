import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"

export function createDb(url: string) {
  const client = postgres(url, { max: 10, onnotice: () => {} })
  return Object.assign(drizzle(client, { schema }), { close: () => client.end() })
}

export type Db = ReturnType<typeof createDb>
export * from "./schema"
