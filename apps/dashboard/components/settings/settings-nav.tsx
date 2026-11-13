"use client"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@skiffr/ui/components/select"
import { cn } from "@skiffr/ui/lib/utils"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { SETTINGS_ENTRIES, SETTINGS_GROUPS, settingsEntryFor } from "./settings-routes"

const SELECT_ITEMS = SETTINGS_ENTRIES.map((entry) => ({ value: entry.href as string, label: entry.label }))

/**
 * The settings sub-nav: a list of links from `lg`, a select below it. One labelled `nav`, so a screen reader finds
 * one landmark at any width. The links keep `aria-current="page"`; the select shows the current entry.
 */
export function SettingsNav() {
  const pathname = usePathname()
  const router = useRouter()
  const current = settingsEntryFor(pathname)

  return (
    <nav
      aria-label="Settings"
      className="px-4 pt-4 md:px-6 lg:sticky lg:top-6 lg:w-60 lg:shrink-0 lg:self-start lg:pt-6 lg:pr-0"
    >
      <div className="lg:hidden">
        <Select
          items={SELECT_ITEMS}
          value={current?.href ?? null}
          onValueChange={(href) => {
            if (href && href !== current?.href) router.push(href as (typeof SETTINGS_ENTRIES)[number]["href"])
          }}
        >
          <SelectTrigger aria-label="Settings section" className="w-full">
            <SelectValue placeholder="Settings" />
          </SelectTrigger>
          <SelectContent>
            {SETTINGS_GROUPS.map((group) => {
              const items = group.entries.map((entry) => (
                <SelectItem key={entry.href} value={entry.href}>
                  {entry.label}
                </SelectItem>
              ))
              return group.label ? (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {items}
                </SelectGroup>
              ) : (
                items
              )
            })}
          </SelectContent>
        </Select>
      </div>
      <ul className="hidden flex-col gap-1 lg:flex">
        {SETTINGS_GROUPS.map((group, index) => (
          <li key={group.label ?? index} className={cn(group.label && "mt-3 flex flex-col gap-1")}>
            {group.label && (
              <span
                id="settings-nav-job-sources"
                className="px-3 font-medium text-muted-foreground text-xs tracking-wide"
              >
                {group.label}
              </span>
            )}
            <ul aria-labelledby={group.label ? "settings-nav-job-sources" : undefined} className="flex flex-col gap-1">
              {group.entries.map((entry) => {
                const active = current?.href === entry.href
                return (
                  <li key={entry.href}>
                    <Link
                      href={entry.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-9 items-center border-l-2 px-3 text-sm transition-colors coarse:min-h-11",
                        active
                          ? "border-foreground bg-muted font-medium text-foreground"
                          : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {entry.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  )
}
