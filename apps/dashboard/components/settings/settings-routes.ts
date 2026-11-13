import type { Route } from "next"

export type SettingsEntry = {
  href: Route
  /** The sub-nav label. */
  label: string
  /** The page h1. */
  title: string
  description: string
}

export type SettingsGroup = { label: string | null; entries: SettingsEntry[] }

/** Order and wording follow DESIGN.md section 3. Gmail alerts and Careers pages stay two routes: the Gmail OAuth return path is fixed. */
export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    label: null,
    entries: [
      {
        href: "/settings/profile",
        label: "Profile",
        title: "Profile",
        description: "The applicant details skiffr fills forms from.",
      },
      {
        href: "/settings/account",
        label: "Account",
        title: "Account",
        description: "Your name, picture and daily AI use.",
      },
      {
        href: "/settings/extension",
        label: "Extension",
        title: "Extension",
        description: "Tokens that connect the browser extension to your account.",
      },
    ],
  },
  {
    label: "Job sources",
    entries: [
      {
        href: "/settings/gmail",
        label: "Gmail alerts",
        title: "Gmail alerts",
        description: "Pull job alert emails into your queue.",
      },
      {
        href: "/settings/sources",
        label: "Careers pages",
        title: "Careers pages",
        description: "Watch careers pages and feeds. New postings land in your queue.",
      },
    ],
  },
  {
    label: null,
    entries: [
      {
        href: "/settings/cv",
        label: "Resume",
        title: "Resume",
        description: "Tailor your Reactive Resume to a job, without adding a single new fact.",
      },
      {
        href: "/settings/privacy",
        label: "Data and privacy",
        title: "Data and privacy",
        description: "What skiffr stores, and what leaves your server.",
      },
      {
        href: "/settings/appearance",
        label: "Appearance",
        title: "Appearance",
        description: "Theme and shortcut settings for this browser.",
      },
    ],
  },
]

export const SETTINGS_ENTRIES: SettingsEntry[] = SETTINGS_GROUPS.flatMap((group) => group.entries)

/** The entry that owns a path, so a nested path (`/settings/gmail/x`) still lights its parent. */
export function settingsEntryFor(pathname: string): SettingsEntry | undefined {
  return SETTINGS_ENTRIES.find((entry) => pathname === entry.href || pathname.startsWith(`${entry.href}/`))
}
