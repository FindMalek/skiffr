"use client"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  SidebarStateScope,
  useSidebar,
} from "@skiffr/ui/components/sidebar"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ADMIN_NAV, isNavActive, type NavItem, PRIMARY_NAV, SETTINGS_NAV } from "@/components/shell/nav"
import { useSidebarPin } from "@/components/shell/shell-provider"

function NavMenu({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return (
    <SidebarMenu>
      {items.map((item) => {
        const active = isNavActive(item, pathname)
        return (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton
              tooltip={item.label}
              isActive={active}
              render={<Link href={item.href} aria-current={active ? "page" : undefined} />}
            >
              <item.icon />
              <span>{item.label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}

/**
 * Both sidebars are in the DOM and CSS shows one: the rail from `md`, the full one from `xl` (or whichever the user
 * pinned with the trigger). The hidden one is `display: none`, so it has no tab stops and no landmark.
 */
export function AppSidebar({ isAdmin }: { isAdmin: boolean }) {
  const { isMobile } = useSidebar()
  const pin = useSidebarPin()
  if (isMobile) return null
  const full = pin === "rail" ? "hidden" : pin === "full" ? "hidden md:contents" : "hidden xl:contents"
  const rail = pin === "full" ? "hidden" : pin === "rail" ? "hidden md:contents" : "hidden md:contents xl:hidden"
  return (
    <>
      <div className={full}>
        <SidebarStateScope state="expanded">
          <SidebarNav isAdmin={isAdmin} />
        </SidebarStateScope>
      </div>
      <div className={rail}>
        <SidebarStateScope state="collapsed">
          <SidebarNav isAdmin={isAdmin} />
        </SidebarStateScope>
      </div>
    </>
  )
}

function SidebarNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname()
  return (
    <Sidebar collapsible="icon">
      <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col">
        <SidebarHeader className="h-14 justify-center border-b p-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="skiffr" render={<Link href="/" />}>
                <span
                  aria-hidden="true"
                  className="grid size-5 shrink-0 place-items-center bg-primary font-heading font-semibold text-primary-foreground text-xs"
                >
                  s
                </span>
                <span className="font-heading font-semibold text-base">skiffr</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <NavMenu items={PRIMARY_NAV} pathname={pathname} />
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarSeparator />
          <SidebarGroup>
            <SidebarGroupContent>
              <NavMenu items={[SETTINGS_NAV]} pathname={pathname} />
            </SidebarGroupContent>
          </SidebarGroup>
          {isAdmin && (
            <SidebarGroup className="mt-auto border-t">
              <SidebarGroupLabel>Admin</SidebarGroupLabel>
              <SidebarGroupContent>
                <NavMenu items={ADMIN_NAV} pathname={pathname} />
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </SidebarContent>
      </nav>
    </Sidebar>
  )
}
