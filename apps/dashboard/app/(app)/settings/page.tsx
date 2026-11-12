import type { Metadata } from "next"
import { AiUsageCard } from "@/components/ai-usage-card"
import { PageHeader } from "@/components/page-header"
import { ProfileForm } from "@/components/profile-form"
import { call } from "@/lib/api"

export const metadata: Metadata = { title: "Settings" }

export default async function SettingsPage() {
  const [me, usage] = await Promise.all([call((api) => api.me.get()), call((api) => api.me.usage()).catch(() => null)])
  return (
    <>
      <PageHeader title="Settings" description="Your account." />
      <div className="grid max-w-xl gap-4 p-4 md:p-6">
        <ProfileForm me={me} />
        {usage && <AiUsageCard usage={usage} />}
      </div>
    </>
  )
}
