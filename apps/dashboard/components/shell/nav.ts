import { BarChart3Icon, HouseIcon, InboxIcon, ListChecksIcon, SettingsIcon, UsersIcon } from "lucide-react"
import type { Route } from "next"
import { settingsEntryFor } from "@/components/settings/settings-routes"

export type NavItem = { href: Route; label: string; icon: typeof HouseIcon }

/** DESIGN.md section 3: the loop first, then settings (one entry, sub-navigation inside), then admin. */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/", label: "Today", icon: HouseIcon },
  { href: "/queue", label: "Queue", icon: InboxIcon },
  { href: "/answers", label: "Answers", icon: ListChecksIcon },
  { href: "/stats", label: "Stats", icon: BarChart3Icon },
]

export const SETTINGS_NAV: NavItem = { href: "/settings/account", label: "Settings", icon: SettingsIcon }

export const ADMIN_NAV: NavItem[] = [{ href: "/users", label: "Users", icon: UsersIcon }]

const owns = (href: string, pathname: string) => pathname === href || pathname.startsWith(`${href}/`)

export function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/") return pathname === "/"
  if (item === SETTINGS_NAV) return pathname === "/settings" || settingsEntryFor(pathname) !== undefined
  return owns(item.href, pathname)
}

/** The More sheet holds what the tab bar has no room for, so it is the current place on settings and admin pages. */
export function isMoreActive(pathname: string): boolean {
  return isNavActive(SETTINGS_NAV, pathname) || ADMIN_NAV.some((item) => isNavActive(item, pathname))
}
