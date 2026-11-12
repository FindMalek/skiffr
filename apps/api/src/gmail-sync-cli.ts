import { createDb } from "@skiffr/db"
import { loadApiEnv } from "@skiffr/env/api"
import { syncDue } from "@skiffr/orpc/gmail"
import { gmailFromEnv } from "./gmail-runtime"

/** One pass over every due mailbox, then exit: for a scheduled job when `GMAIL_SCHEDULER=off`. */
const env = loadApiEnv()
const gmail = gmailFromEnv(env)
if (!gmail) {
  console.info("gmail import is not configured")
  process.exit(0)
}
const db = createDb(env.DATABASE_URL)
const results = await syncDue({ db, runtime: gmail.runtime, now: () => new Date(), tokens: gmail.tokens })
console.info(`gmail sync ran ${results.length} mailboxes`)
await db.close()
