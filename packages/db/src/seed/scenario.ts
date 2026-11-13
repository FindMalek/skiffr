import type { user } from "../schema"

type NewUser = typeof user.$inferInsert

const DAY = 864e5

/** mulberry32: a tiny seeded PRNG, so every preview gets the same data (only the dates move with "now"). */
export function random(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FIRST = [
  "Ada",
  "Linus",
  "Grace",
  "Alan",
  "Margaret",
  "Ken",
  "Barbara",
  "Dennis",
  "Radia",
  "Guido",
  "Frances",
  "Bjarne",
]
const LAST = [
  "Lovelace",
  "Torvalds",
  "Hopper",
  "Turing",
  "Hamilton",
  "Thompson",
  "Liskov",
  "Ritchie",
  "Perlman",
  "Rossum",
]

/**
 * Sample users relative to `now`: a dozen (a couple of admins, some unverified, one banned, signed up over three months).
 * When a feature adds a state, add it here and to scenario.test.ts so every preview shows it.
 */
export function buildScenario(now: Date, seed = 20261017) {
  const rand = random(seed)
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!
  const daysAgo = (max: number) => new Date(now.getTime() - Math.floor(rand() * max * DAY))

  const users: NewUser[] = FIRST.map((first, i) => {
    const name = `${first} ${pick(LAST)}`
    const createdAt = daysAgo(90)
    return {
      id: `demo-user-${i + 1}`,
      name,
      email: `${first.toLowerCase()}.${i + 1}@example.com`,
      emailVerified: i % 4 !== 3,
      role: i < 2 ? "admin" : "user",
      banned: i === 11,
      createdAt,
      updatedAt: createdAt,
    }
  })

  return { users }
}
