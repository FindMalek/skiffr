"use client"

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@skiffr/ui/components/sheet"
import { cn } from "@skiffr/ui/lib/utils"
import { EllipsisIcon } from "lucide-react"
import type { Route } from "next"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"
import { SETTINGS_GROUPS } from "@/components/settings/settings-routes"
import { ADMIN_NAV, isMoreActive, isNavActive, PRIMARY_NAV } from "./nav"

const TAB =
  "flex h-full min-w-0 flex-col items-center justify-center gap-1 border-t-2 border-transparent px-1 text-muted-foreground text-xs forced-colors:border-t-0 [&_svg]:size-5 [&_svg]:shrink-0 forced-colors:text-[LinkText]"
const TAB_ACTIVE =
  "forced-colors:border-t-2 border-foreground bg-muted font-medium text-foreground forced-colors:border-[Highlight]"

const SHEET_LINK =
  "flex min-h-11 items-center border-l-2 border-transparent px-3 text-sm hover:bg-muted forced-colors:border-l-0"

/** Below `md`: Today, Queue, Answers, Stats and More. The More sheet is the only way to the rest, and its only trigger. */
export function TabBar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname()
  const [more, setMore] = useState(false)

  return (
    <>
      <nav
        aria-label="Main"
        data-shell-tab-bar=""
        className="fixed inset-x-0 bottom-0 z-bar box-content grid h-(--tab-bar-h) grid-cols-5 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {PRIMARY_NAV.map((item) => {
          const active = isNavActive(item, pathname)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(TAB, active && TAB_ACTIVE)}
            >
              <item.icon aria-hidden="true" />
              {item.label}
            </Link>
          )
        })}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={more}
          onClick={() => setMore(true)}
          className={cn(TAB, isMoreActive(pathname) && TAB_ACTIVE)}
        >
          <EllipsisIcon aria-hidden="true" />
          More
        </button>
      </nav>
      <Sheet open={more} onOpenChange={setMore}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          <SheetHeader>
            <SheetTitle>More</SheetTitle>
            <SheetDescription className="sr-only">Settings and admin pages.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 pb-4">
            <MoreLinks
              label="Settings pages"
              links={SETTINGS_GROUPS.flatMap((group) => group.entries).map((entry) => ({
                href: entry.href,
                label: entry.label,
              }))}
              pathname={pathname}
              onNavigate={() => setMore(false)}
            />
            {isAdmin && (
              <MoreLinks
                label="Admin pages"
                links={ADMIN_NAV.map((item) => ({ href: item.href, label: item.label }))}
                pathname={pathname}
                onNavigate={() => setMore(false)}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

function MoreLinks({
  label,
  links,
  pathname,
  onNavigate,
}: {
  label: string
  links: { href: Route; label: string }[]
  pathname: string
  onNavigate: () => void
}) {
  return (
    <nav aria-label={label}>
      <p className="px-3 pb-1 font-medium text-muted-foreground text-xs tracking-wide">{label.replace(" pages", "")}</p>
      <ul className="flex flex-col">
        {links.map((link) => {
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`)
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(SHEET_LINK, active && "border-foreground bg-muted font-medium forced-colors:border-l-2")}
              >
                {link.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
