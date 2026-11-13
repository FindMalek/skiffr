import { SettingsHeader } from "@/components/settings/settings-header"
import { SettingsNav } from "@/components/settings/settings-nav"

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SettingsHeader />
      <div className="flex max-w-6xl flex-col lg:flex-row">
        <SettingsNav />
        <div className="@container min-w-0 flex-1">{children}</div>
      </div>
    </>
  )
}
