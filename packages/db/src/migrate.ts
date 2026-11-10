import { migrate } from "drizzle-orm/postgres-js/migrator"
import type { Db } from "./index"

const MIGRATIONS = new URL("../drizzle", import.meta.url).pathname

export function runMigrations(db: Db, folder = process.env.MIGRATIONS_DIR ?? MIGRATIONS): Promise<void> {
  return migrate(db, { migrationsFolder: folder })
}
