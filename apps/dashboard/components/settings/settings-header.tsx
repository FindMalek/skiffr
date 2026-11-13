"use client"

import { usePathname } from "next/navigation"
import { PageHeader } from "@/components/page-header"
import { settingsEntryFor } from "./settings-routes"

/** One header for every settings page, so the h1 follows the sub-nav and the pages hold only their content. */
export function SettingsHeader() {
  const entry = settingsEntryFor(usePathname())
  return (
    <PageHeader
      title={entry?.title ?? "Settings"}
      description={entry?.description}
      breadcrumb={entry ? [{ label: "Settings", href: "/settings/account" }, { label: entry.title }] : undefined}
    />
  )
}
