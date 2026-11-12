import { ORPCError } from "@orpc/server"
import { type Db, gmailAccount, user, verification } from "@skiffr/db"
import * as schema from "@skiffr/db/schema"
import type { Storage } from "@skiffr/storage"
import { and, eq, getTableColumns, is, ne, or, sql } from "drizzle-orm"
import { PgTable } from "drizzle-orm/pg-core"
import type { GmailRuntime, TokenCache } from "../gmail"
import { open } from "../gmail/crypto"
import { revokeToken } from "../gmail/google"

export interface DeleteDeps {
  db: Db
  gmail: { runtime: GmailRuntime; tokens: TokenCache } | null | undefined
  storage: Storage | null
}

const LAST_ADMIN = new ORPCError("BAD_REQUEST", {
  message: "You are the last admin. Make someone else an admin first.",
})

async function roleOf(db: Pick<Db, "select">, userId: string): Promise<string | null | undefined> {
  const [row] = await db.select({ role: user.role }).from(user).where(eq(user.id, userId))
  return row?.role
}

async function otherAdminExists(db: Pick<Db, "select">, userId: string): Promise<boolean> {
  const [other] = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.role, "admin"), ne(user.id, userId)))
    .limit(1)
  return Boolean(other)
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Every table that has a `userId` column, found in the schema, so a table added later is deleted without anyone remembering to list it. */
function userTables(): PgTable[] {
  return (Object.values(schema) as unknown[]).filter(
    (value): value is PgTable => is(value, PgTable) && "userId" in getTableColumns(value),
  )
}

/**
 * The pictures `me.avatar` stored for this user: `<prefix>avatars/<id>-<time>.<ext>`. The id is matched whole, so `ana`
 * never takes `ana-2`'s. A key that can't be deleted is logged (it holds the internal id and a time, no email), because
 * the user is gone by then and the operator has nothing else to find it by.
 */
async function removeAvatars(storage: Storage, userId: string): Promise<boolean> {
  const failed: string[] = []
  try {
    const own = new RegExp(`^${escapeRegExp(`${storage.prefix}avatars/${userId}-`)}\\d+\\.(jpg|png|webp)$`)
    for (const key of (await storage.list(`${storage.prefix}avatars/${userId}-`)).filter((key) => own.test(key))) {
      await storage.delete(key).catch(() => failed.push(key))
    }
  } catch {
    failed.push(`${storage.prefix}avatars/${userId}-*`)
  }
  if (failed.length > 0) console.warn("[account.delete] files not removed", { keys: failed })
  return failed.length === 0
}

/**
 * Deletes the user and everything of theirs: one transaction removes every row with their user id and the user, which
 * ends the sessions and the tokens. The user row goes in the same transaction, so a background run still holding their
 * account can't write a row back: its insert hits the foreign key. Only after the commit is the Google grant revoked
 * (best effort) and the pictures removed, so a refused or failed delete never disconnects anything; a crash between the
 * two leaves a grant at Google that the user can remove at myaccount.google.com/permissions. A second call (or a
 * concurrent one) finds nothing and answers the same.
 */
export async function deleteAccount(
  { db, gmail, storage }: DeleteDeps,
  owner: { id: string; email: string },
): Promise<{ gmailRevoked: boolean | null; filesRemoved: boolean }> {
  // Checked again inside the transaction, where it can't race another admin. This one only spares a refused call the work.
  if ((await roleOf(db, owner.id)) === "admin" && !(await otherAdminExists(db, owner.id))) throw LAST_ADMIN
  const [mailbox] = await db
    .select({ id: gmailAccount.id, refreshTokenEnc: gmailAccount.refreshTokenEnc })
    .from(gmailAccount)
    .where(eq(gmailAccount.userId, owner.id))

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`account-delete:${owner.id}`}))`)
    // The role is read here, not from the session, which keeps the role it was cached with. One lock for all admins, or
    // two of them could each see the other. Read committed matters: the second delete must see the first one's commit
    // after it gets the lock, a repeatable read transaction would not.
    if ((await roleOf(tx, owner.id)) === "admin") {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('account-delete-admin'))`)
      if (!(await otherAdminExists(tx, owner.id))) throw LAST_ADMIN
    }
    for (const table of userTables()) {
      await tx.delete(table).where(eq(getTableColumns(table).userId!, owner.id))
    }
    // Reset links hold the user id, magic links hold the email inside their value.
    await tx
      .delete(verification)
      .where(
        or(
          eq(verification.identifier, owner.email),
          eq(verification.value, owner.id),
          sql`strpos(lower(${verification.value}), ${owner.email.toLowerCase()}) > 0`,
        ),
      )
    await tx.delete(user).where(eq(user.id, owner.id))
  })

  return {
    gmailRevoked: mailbox ? await revokeAfterDelete(gmail, mailbox, owner.id) : null,
    filesRemoved: storage ? await removeAvatars(storage, owner.id) : true,
  }
}

async function revokeAfterDelete(
  gmail: DeleteDeps["gmail"],
  mailbox: { id: string; refreshTokenEnc: string },
  userId: string,
): Promise<boolean> {
  gmail?.tokens.delete(mailbox.id)
  if (!gmail) return false
  try {
    return await revokeToken(gmail.runtime, open(gmail.runtime.key, mailbox.refreshTokenEnc, userId))
  } catch {
    return false
  }
}
