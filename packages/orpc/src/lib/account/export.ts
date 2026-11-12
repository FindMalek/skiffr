import { ORPCError } from "@orpc/server"
import { ACCOUNT_EXPORT_BYTES_MAX, ACCOUNT_EXPORT_ROWS_MAX, ACCOUNT_EXPORT_VERSION } from "@skiffr/common/constants"
import type { AccountExport } from "@skiffr/common/schemas"
import {
  aiUsage,
  answer,
  apiToken,
  application,
  cvConnection,
  type Db,
  fieldEvent,
  gmailAccount,
  gmailMessage,
  job,
  jobSource,
  notes,
  profile,
  siteProfile,
} from "@skiffr/db"
import { asc, count, eq, getTableColumns, type SQL, sql } from "drizzle-orm"
import type { PgTable } from "drizzle-orm/pg-core"

type UserTable = PgTable & { userId: Parameters<typeof eq>[0] }
type Section = Exclude<keyof AccountExport, "version" | "generatedAt" | "account">

interface Spec {
  section: Section
  table: UserTable
  /** Columns left out: the user id (it is the caller) and every secret or server-only column. A new column is exported unless it is listed here. */
  omit: string[]
  /** Column keys that fix the row order. */
  order: string[]
  single?: boolean
}

/** What leaves the server, per table. The export test fails for a user table that is in neither list, and for a secret-looking key. */
export const EXPORTED: Spec[] = [
  { section: "profile", table: profile, omit: ["userId"], order: ["id"], single: true },
  { section: "answers", table: answer, omit: ["userId", "embedding"], order: ["normalizedLabel", "id"] },
  { section: "jobs", table: job, omit: ["userId"], order: ["createdAt", "id"] },
  { section: "applications", table: application, omit: ["userId"], order: ["appliedAt", "id"] },
  { section: "fieldEvents", table: fieldEvent, omit: ["userId"], order: ["createdAt", "id"] },
  { section: "siteProfiles", table: siteProfile, omit: ["userId"], order: ["siteKey", "formSignature", "id"] },
  {
    section: "jobSources",
    table: jobSource,
    omit: ["userId", "leaseUntil", "etag", "lastModified"],
    order: ["createdAt", "id"],
  },
  {
    section: "gmailAccount",
    table: gmailAccount,
    omit: ["userId", "refreshTokenEnc", "leaseUntil"],
    order: ["id"],
    single: true,
  },
  { section: "gmailMessages", table: gmailMessage, omit: ["userId", "accountId"], order: ["processedAt", "id"] },
  {
    section: "cvConnection",
    table: cvConnection,
    omit: ["userId", "apiKeyEnc", "keyLast4"],
    order: ["id"],
    single: true,
  },
  { section: "notes", table: notes, omit: ["userId"], order: ["createdAt", "id"] },
  { section: "tokens", table: apiToken, omit: ["userId", "tokenHash", "prefix", "last4"], order: ["createdAt", "id"] },
  { section: "aiUsage", table: aiUsage, omit: ["userId"], order: ["day"] },
]

/** Tables with a `user_id` that are deliberately not in the export, and why. */
export const NOT_EXPORTED: Record<string, string> = {
  session: "sign-in sessions, with the ip and browser of each",
  account: "sign-in credentials: the password hash and provider tokens",
  record_batch: "the idempotency cache of the learning endpoint, no user content of its own",
  gmail_oauth_state: "a consent flow in progress: a PKCE verifier and a state hash",
}

const selection = ({ table, omit }: Spec) =>
  Object.fromEntries(Object.entries(getTableColumns(table)).filter(([key]) => !omit.includes(key)))

/** The text length of the exported columns of one row, in bytes: what the document will weigh, not what is stored (stored values are compressed). */
const rowBytes = (spec: Spec): SQL => {
  const columns = Object.values(selection(spec))
  return sql.join(
    columns.map((column) => sql`coalesce(octet_length(${column}::text), 0)`),
    sql` + `,
  )
}

export interface ExportLimits {
  rows: number
  bytes: number
}

/** Everything the user owns in one document, read in one snapshot. Refuses an account above the limits (rows and, mostly, bytes) rather than building a document that can't be held in memory. */
export async function buildExport(
  db: Db,
  owner: { id: string; name: string; email: string; image: string | null; createdAt: Date },
  now: Date,
  limits: ExportLimits = { rows: ACCOUNT_EXPORT_ROWS_MAX, bytes: ACCOUNT_EXPORT_BYTES_MAX },
): Promise<AccountExport> {
  return db.transaction(
    async (tx) => {
      let rows = 0
      let bytes = 0
      for (const spec of EXPORTED) {
        const [total] = await tx
          .select({ n: count(), bytes: sql<string>`coalesce(sum(${rowBytes(spec)}), 0)` })
          .from(spec.table)
          .where(eq(spec.table.userId, owner.id))
        rows += total?.n ?? 0
        bytes += Number(total?.bytes ?? 0)
      }
      if (rows > limits.rows || bytes > limits.bytes) {
        const mb = (n: number) => `${Math.ceil(n / 1024 / 1024)} MB`
        throw new ORPCError("PAYLOAD_TOO_LARGE", {
          message: `Too much to export in one file (${rows} rows, about ${mb(bytes)}; the limits are ${limits.rows} rows and ${mb(limits.bytes)}). Ask whoever runs this instance for a database dump.`,
        })
      }
      const document: Record<string, unknown> = {
        version: ACCOUNT_EXPORT_VERSION,
        generatedAt: now,
        account: { name: owner.name, email: owner.email, image: owner.image, createdAt: owner.createdAt },
      }
      for (const spec of EXPORTED) {
        const columns = getTableColumns(spec.table)
        const found = await tx
          .select(selection(spec))
          .from(spec.table)
          .where(eq(spec.table.userId, owner.id))
          .orderBy(...spec.order.map((key) => asc(columns[key]!)))
        document[spec.section] = spec.single ? (found[0] ?? null) : found
      }
      return document as AccountExport
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  )
}
