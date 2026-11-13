import type { AdminUser } from "@skiffr/common/schemas"
import { foldForSearch } from "@/lib/answers"

export const USERS_PAGE_SIZE = 10

/** Name or email, case and accents ignored. */
export function filterUsers(users: AdminUser[], query: string): AdminUser[] {
  const needle = foldForSearch(query)
  if (needle === "") return users
  return users.filter((row) => foldForSearch(row.name).includes(needle) || foldForSearch(row.email).includes(needle))
}

/** Banned and unverified are separate facts about one account, so both can show. */
export function userMarkers(row: AdminUser): ("banned" | "unverified")[] {
  const markers: ("banned" | "unverified")[] = []
  if (row.banned) markers.push("banned")
  if (!row.emailVerified) markers.push("unverified")
  return markers
}

/** Announced to screen readers after the search changes. */
export function usersSentence(shown: number, loaded: number): string {
  if (loaded === 0) return "No users."
  if (shown === 0) return "No users match."
  return `${shown} of ${loaded} users.`
}

/** The api returns the newest accounts only; say so instead of presenting them as everyone. */
export function limitSentence(loaded: number, total: number): string | null {
  return total > loaded ? `Showing the ${loaded} newest of ${total} accounts. Search only covers these.` : null
}
