import { SidebarInset } from "@skiffr/ui/components/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { PaletteProvider } from "@/components/shell/palette"
import { RouteFocus } from "@/components/shell/route-focus"
import { ShellProvider } from "@/components/shell/shell-provider"
import { TabBar } from "@/components/shell/tab-bar"
import { TopBar } from "@/components/shell/top-bar"
import { call } from "@/lib/api"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await call((api) => api.me.get())
  const isAdmin = me.role === "admin"
  return (
    <ShellProvider>
      <PaletteProvider isAdmin={isAdmin}>
        <AppSidebar isAdmin={isAdmin} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar me={me} />
          <SidebarInset
            id="main"
            tabIndex={-1}
            className="min-w-0 pb-[calc(var(--tab-bar-h)+var(--action-bar-h)+env(safe-area-inset-bottom))] outline-none md:pb-0"
          >
            {children}
          </SidebarInset>
        </div>
        <TabBar isAdmin={isAdmin} />
        <RouteFocus />
      </PaletteProvider>
    </ShellProvider>
  )
}
