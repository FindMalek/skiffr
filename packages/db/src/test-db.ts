import { randomBytes } from "node:crypto"
import postgres from "postgres"
import { createDb, type Db } from "./index"
import { runMigrations } from "./migrate"

const PREFIX = "skiffr_test"

const onlyStrings = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new TypeError("A date reached the driver as an object: bind it through a typed column or pass an ISO string")
  }
  return value
}

/**
 * pglite turns a `Date` into text by itself, postgres-js (the production driver) throws on one. Tests on pglite pass these
 * as `serializers` so a `Date` interpolated into a raw `sql` template fails here too, not only in the postgres run.
 */
export const strictDateSerializers = { 1082: onlyStrings, 1114: onlyStrings, 1184: onlyStrings }

export function assertTestUrl(url: string): URL {
  const parsed = new URL(url)
  const name = parsed.pathname.slice(1)
  if (!name.startsWith(PREFIX)) {
    throw new Error(`TEST_DATABASE_URL must point at a database named ${PREFIX}*, got "${name}"`)
  }
  return parsed
}

/** Creates a fresh `skiffr_test_<random>` database on the server of `serverUrl`, migrates it, and returns a `drop` that removes it. */
export async function createTestDb(serverUrl: string): Promise<{ db: Db; drop: () => Promise<void> }> {
  const server = assertTestUrl(serverUrl)
  const name = `${PREFIX}_${randomBytes(4).toString("hex")}`
  const admin = postgres(server.href, { max: 1, onnotice: () => {} })
  await admin.unsafe(`CREATE DATABASE ${name}`)

  const url = new URL(server)
  url.pathname = `/${name}`
  const db = createDb(url.href)
  const drop = async () => {
    await db.close()
    await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
    await admin.end()
  }
  try {
    await runMigrations(db)
  } catch (error) {
    await drop()
    throw error
  }
  return { db, drop }
}
