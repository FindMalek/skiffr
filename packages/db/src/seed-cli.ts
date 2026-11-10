import { createDb } from "./index"
import { seedDemo } from "./seed/index"

const db = createDb(process.env.DATABASE_URL!)
console.info((await seedDemo(db)) ? "seeded" : "database not empty, nothing seeded")
await db.close()
