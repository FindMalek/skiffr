"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@skiffr/ui/components/avatar"
import { Button } from "@skiffr/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@skiffr/ui/components/dropdown-menu"
import { useIsMobile } from "@skiffr/ui/hooks/use-mobile"
import { KeyboardIcon, LogOutIcon, PaletteIcon, SettingsIcon } from "lucide-react"
import Link from "next/link"
import { useTheme } from "next-themes"
import { toast } from "sonner"
import { useShortcutsEnabled } from "@/lib/shortcuts-setting"
import { ShortcutKeys, useShortcutsHelp } from "./shortcuts"

export interface ShellUser {
  name: string
  email: string
  image: string | null
  role: string | null
}

const THEMES = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const

/** Sign out is one click. The theme choice lives here too because the mobile top bar has no theme button. */
export function UserMenu({ me }: { me: ShellUser }) {
  const { theme, setTheme } = useTheme()
  const isMobile = useIsMobile()
  const help = useShortcutsHelp()
  const shortcuts = useShortcutsEnabled()
  // The auth client is only needed here, so it loads when you press Sign out, not with every page.
  const signOut = async () => {
    try {
      const { authClient } = await import("@skiffr/auth/client")
      const result = await authClient.signOut()
      if (result.error) throw new Error(result.error.message)
      window.location.assign("/sign-in")
    } catch {
      toast.error("Could not sign out. Check your connection and try again.")
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label={`Account menu, ${me.name}`} className="p-0" />}
      >
        <Avatar>
          {me.image && <AvatarImage src={me.image} alt="" />}
          <AvatarFallback>{me.name.slice(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span className="truncate font-medium text-foreground text-sm">{me.name}</span>
            <span className="truncate">{me.email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/settings/account" />}>
          <SettingsIcon />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/settings/appearance" />}>
          <PaletteIcon />
          Appearance
        </DropdownMenuItem>
        <DropdownMenuItem onClick={help.open} aria-keyshortcuts={shortcuts ? "?" : undefined}>
          <KeyboardIcon />
          Keyboard shortcuts
          {shortcuts && (
            <span aria-hidden="true" className="ml-auto max-md:hidden">
              <ShortcutKeys keys={["?"]} />
            </span>
          )}
        </DropdownMenuItem>
        {isMobile && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Theme</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={(value) => setTheme(String(value))}>
                {THEMES.map((option) => (
                  <DropdownMenuRadioItem key={option.value} value={option.value}>
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
