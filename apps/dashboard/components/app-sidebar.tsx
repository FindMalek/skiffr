"use client"

import { authClient } from "@skiffr/auth/client"
import { Avatar, AvatarFallback, AvatarImage } from "@skiffr/ui/components/avatar"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@skiffr/ui/components/sidebar"
import { LayoutDashboardIcon, LogOutIcon, NotebookPenIcon, SettingsIcon, UsersIcon } from "lucide-react"
import type { Route } from "next"
import Link from "next/link"
import { usePathname } from "next/navigation"

interface Me {
  name: string
  email: string
  image: string | null
  role: string | null
}

const NAV: { href: Route; label: string; icon: typeof LayoutDashboardIcon; admin?: boolean }[] = [
  { href: "/", label: "Overview", icon: LayoutDashboardIcon },
  { href: "/notes", label: "Notes", icon: NotebookPenIcon },
  { href: "/users", label: "Users", icon: UsersIcon, admin: true },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
]

export function AppSidebar({ me }: { me: Me }) {
  const pathname = usePathname()
  const signOut = async () => {
    await authClient.signOut()
    window.location.assign("/sign-in")
  }
  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" />}>
              <span className="grid size-8 place-items-center bg-primary font-bold text-primary-foreground">a</span>
              <span className="font-heading font-semibold">skiffr</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.filter((item) => !item.admin || me.role === "admin").map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    tooltip={item.label}
                    isActive={item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)}
                    render={<Link href={item.href} />}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip="Sign out" onClick={signOut}>
              <Avatar className="size-8">
                {me.image && <AvatarImage src={me.image} alt="" />}
                <AvatarFallback>{me.name.slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{me.name}</span>
                <span className="truncate text-muted-foreground text-xs">{me.email}</span>
              </span>
              <LogOutIcon className="ml-auto" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
