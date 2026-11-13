import { AppShell } from "@/components/shell/app-shell"
import { call } from "@/lib/api"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await call((api) => api.me.get())
  return <AppShell me={me}>{children}</AppShell>
}
