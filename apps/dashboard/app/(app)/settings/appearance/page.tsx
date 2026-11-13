import type { Metadata } from "next"
import { AppearanceSettings } from "@/components/settings/appearance-settings"

export const metadata: Metadata = { title: "Appearance" }

export default function AppearancePage() {
  return (
    <div className="flex max-w-3xl flex-col gap-8 p-4 md:p-6">
      <AppearanceSettings />
    </div>
  )
}
