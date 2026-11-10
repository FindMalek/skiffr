import { SidebarInset, SidebarProvider } from "@skiffr/ui/components/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { call } from "@/lib/api"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await call((api) => api.me.get())
  return (
    <SidebarProvider>
      <AppSidebar me={me} />
      <SidebarInset className="min-w-0">{children}</SidebarInset>
    </SidebarProvider>
  )
}
