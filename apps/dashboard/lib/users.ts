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

export type UsersView = { filtered: number; loaded: number; page: number; pages: number; first: number; last: number }

/** The one live region: what a screen reader hears after the search changes or a page button is pressed. */
export function usersSentence(view: UsersView, limited: boolean): string {
  if (view.loaded === 0) return "No users."
  if (view.filtered === 0) return `No users match.${limited ? " Only the newest accounts are searched." : ""}`
  return `Page ${view.page} of ${view.pages}, showing ${view.first}-${view.last} of ${view.filtered} users.`
}

/** The api returns the newest accounts only; say so instead of presenting them as everyone. */
export function limitSentence(loaded: number, total: number): string | null {
  return total > loaded ? `Showing the ${loaded} newest of ${total} accounts. Search only covers these.` : null
}
