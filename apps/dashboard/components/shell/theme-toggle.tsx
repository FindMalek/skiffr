"use client"

import { Button } from "@skiffr/ui/components/button"
import { MoonIcon, SunIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { useSyncExternalStore } from "react"

const noSubscription = () => () => {}

/** One click between light and dark. "System" is chosen on the appearance page. */
export function useThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  )
  const next = mounted && resolvedTheme === "dark" ? "light" : "dark"
  return { next, toggle: () => setTheme(next) }
}

export function ThemeToggle() {
  const { next, toggle } = useThemeToggle()
  return (
    <Button variant="ghost" size="icon" aria-label={`Switch to ${next} theme`} onClick={toggle}>
      <SunIcon className="dark:hidden" />
      <MoonIcon className="hidden dark:block" />
    </Button>
  )
}
