import type { Metadata } from "next"
import { PageHeader } from "@/components/page-header"
import { ProfileForm } from "@/components/profile-form"
import { call } from "@/lib/api"

export const metadata: Metadata = { title: "Settings" }

export default async function SettingsPage() {
  const me = await call((api) => api.me.get())
  return (
    <>
      <PageHeader title="Settings" description="Your account." />
      <div className="max-w-xl p-4 md:p-6">
        <ProfileForm me={me} />
      </div>
    </>
  )
}
