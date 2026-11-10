import { count } from "drizzle-orm"
import type { Db } from "../index"
import { notes, user } from "../schema"
import { buildScenario } from "./scenario"

export { buildScenario } from "./scenario"

/** Writes the demo scenario into an empty database only, so it never touches real data. */
export async function seedDemo(db: Db, opts: { ownerId?: string } = {}): Promise<boolean> {
  const [existing] = await db.select({ n: count() }).from(notes)
  if ((existing?.n ?? 0) > 0) return false
  const scenario = buildScenario(new Date(), opts)
  await db.transaction(async (tx) => {
    await tx.insert(user).values(scenario.users).onConflictDoNothing()
    await tx.insert(notes).values(scenario.notes)
  })
  return true
}
