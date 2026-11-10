import type { notes, user } from "../schema"

type NewUser = typeof user.$inferInsert
type NewNote = typeof notes.$inferInsert

const DAY = 864e5

/** mulberry32: a tiny seeded PRNG, so every preview gets the same data (only the dates move with "now"). */
function random(seed: number) {
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
const TITLES = [
  "Launch checklist",
  "Ideas for the landing page",
  "Pricing thoughts",
  "Customer interview notes",
  "Bug: login redirect on Safari",
  "Weekly review",
  "Onboarding email copy",
  "Things to automate",
  "Reading list",
  "Q4 goals",
]

/**
 * Demo data relative to `now`: a dozen users (a couple of admins, some unverified, signed up over three months) and
 * notes for each of them and for the seeded admin, pinned and not, short and long, old and fresh.
 * When a feature adds a state, add it here and to scenario.test.ts so every preview shows it.
 */
export function buildScenario(now: Date, opts: { ownerId?: string } = {}, seed = 20261017) {
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

  const owners = [...users.map((u) => u.id!), ...(opts.ownerId ? [opts.ownerId] : [])]
  const notesRows: NewNote[] = owners.flatMap((userId) =>
    Array.from({ length: 2 + Math.floor(rand() * 5) }, (_, j) => {
      const createdAt = daysAgo(60)
      return {
        userId,
        title: pick(TITLES),
        body: j % 3 === 0 ? "" : "Write the first version, ship it to a preview, then ask two people what they think.",
        pinned: j === 0,
        createdAt,
        updatedAt: new Date(Math.min(now.getTime(), createdAt.getTime() + Math.floor(rand() * 10) * DAY)),
      }
    }),
  )

  return { users, notes: notesRows }
}
