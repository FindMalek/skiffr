import type { Metadata } from "next"
import { AiUsageCard } from "@/components/ai-usage-card"
import { ProfileForm } from "@/components/profile-form"
import { call } from "@/lib/api"

export const metadata: Metadata = { title: "Account" }

export default async function AccountPage() {
  const [me, usage] = await Promise.all([call((api) => api.me.get()), call((api) => api.me.usage()).catch(() => null)])
  return (
    <div className="flex max-w-3xl flex-col gap-8 p-4 md:p-6">
      <ProfileForm me={me} />
      <AiUsageCard usage={usage} />
    </div>
  )
}
