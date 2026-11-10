import type { Auth } from "@skiffr/auth"
import { type Db, user } from "@skiffr/db"
import { eq } from "drizzle-orm"

/** The env admin is the source of truth: created on first start, its password and role reset on every start. */
export async function ensureAdmin(db: Db, auth: Auth, email?: string, password?: string): Promise<string | undefined> {
  if (!email || !password) return undefined
  const ctx = await auth.$context
  const existing = await db.query.user.findFirst({ where: eq(user.email, email.toLowerCase()) })
  if (!existing) {
    const { user: created } = await auth.api.signUpEmail({ body: { email, password, name: "Admin" } })
    await db.update(user).set({ role: "admin", emailVerified: true }).where(eq(user.id, created.id))
    return created.id
  }
  await ctx.internalAdapter.updatePassword(existing.id, await ctx.password.hash(password))
  await db.update(user).set({ role: "admin" }).where(eq(user.id, existing.id))
  return existing.id
}
