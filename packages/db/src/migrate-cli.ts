import { createDb } from "./index"
import { runMigrations } from "./migrate"

const db = createDb(process.env.DATABASE_URL!)
await runMigrations(db)
await db.close()
console.info("migrations applied")
