import { SidebarTrigger } from "@skiffr/ui/components/sidebar"
import Link from "next/link"
import { SearchButton } from "./palette"
import { ThemeToggle } from "./theme-toggle"
import { type ShellUser, UserMenu } from "./user-menu"

/**
 * The one banner landmark, sticky, 56px. From `md`: sidebar trigger, search, theme, user menu. Below `md` there is no
 * sidebar, so the wordmark takes the trigger's place and the theme lives in the user menu.
 */
export function TopBar({ me }: { me: ShellUser }) {
  return (
    <header className="sticky top-0 z-bar flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4 md:px-6">
      <div className="hidden md:block">
        <SidebarTrigger />
      </div>
      <Link href="/" className="flex h-(--control-h) items-center gap-2 font-heading font-semibold text-base md:hidden">
        <span aria-hidden="true" className="grid size-7 place-items-center bg-primary text-primary-foreground text-sm">
          s
        </span>
        skiffr
      </Link>
      <div className="ml-auto flex items-center gap-2">
        <SearchButton />
        <div className="hidden md:block">
          <ThemeToggle />
        </div>
        <UserMenu me={me} />
      </div>
    </header>
  )
}
