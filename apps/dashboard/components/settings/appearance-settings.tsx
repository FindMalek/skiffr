"use client"

import { Section } from "@skiffr/ui/components/section"
import { SegmentedControl, SegmentedControlItem } from "@skiffr/ui/components/segmented-control"
import { Switch } from "@skiffr/ui/components/switch"
import { useTheme } from "next-themes"
import { useId, useSyncExternalStore } from "react"
import { useShortcutsEnabled, writeShortcutsEnabled } from "@/lib/shortcuts-setting"

const THEMES = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const

const noSubscription = () => () => {}

/** The theme is only known in the browser, so the server markup and the first client render leave the choice empty. */
function useMounted(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  )
}

export function AppearanceSettings() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const mounted = useMounted()
  const shortcuts = useShortcutsEnabled()
  const shortcutsId = useId()
  const shortcutsHint = useId()
  const themeHint = useId()

  return (
    <>
      <Section title="Theme" description="Applies to this browser.">
        <SegmentedControl
          aria-label="Theme"
          aria-describedby={themeHint}
          value={mounted ? (theme ?? "system") : ""}
          onValueChange={(value) => setTheme(String(value))}
        >
          {THEMES.map((option) => (
            <SegmentedControlItem key={option.value} value={option.value} className="min-w-24">
              {option.label}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        <p id={themeHint} className="text-muted-foreground text-xs">
          {mounted && theme === "system"
            ? `System follows your device. It is ${resolvedTheme === "dark" ? "dark" : "light"} now.`
            : "System follows your device."}
        </p>
      </Section>
      <Section
        title="Keyboard shortcuts"
        description="Single key shortcuts are not available yet. This switch is saved in this browser and will control them when they ship."
      >
        <div className="flex min-h-11 max-w-md items-stretch justify-between gap-4 border">
          <div className="flex min-w-0 flex-1 flex-col gap-1 py-4 pl-4">
            <label htmlFor={shortcutsId} className="font-medium text-sm">
              Single key shortcuts
            </label>
            <p id={shortcutsHint} className="text-muted-foreground text-xs">
              {shortcuts ? "On in this browser." : "Off in this browser."}
            </p>
          </div>
          <span className="flex items-center pr-4">
            <Switch
              id={shortcutsId}
              checked={shortcuts}
              onCheckedChange={writeShortcutsEnabled}
              aria-describedby={shortcutsHint}
            />
          </span>
        </div>
      </Section>
    </>
  )
}
