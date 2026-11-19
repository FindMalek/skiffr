import { SidebarInset } from "@skiffr/ui/components/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { PaletteProvider } from "./palette"
import { RouteFocus } from "./route-focus"
import { ShellProvider } from "./shell-provider"
import { ShortcutsProvider } from "./shortcuts"
import { TabBar } from "./tab-bar"
import { TopBar } from "./top-bar"
import type { ShellUser } from "./user-menu"

/** The signed-in frame: sidebar, top bar, `main#main`, tab bar and the palette. Used by the app layout and the 404. */
export function AppShell({ me, children }: { me: ShellUser; children: React.ReactNode }) {
  const isAdmin = me.role === "admin"
  return (
    <ShellProvider>
      <PaletteProvider isAdmin={isAdmin}>
        <ShortcutsProvider>
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
        </ShortcutsProvider>
      </PaletteProvider>
    </ShellProvider>
  )
}
