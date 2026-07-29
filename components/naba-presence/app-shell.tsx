"use client"

import {
  BarChart3,
  Building2,
  ChevronsUpDown,
  LayoutDashboard,
  Link2,
  LogOut,
  MessageSquareText,
  Moon,
  Settings,
  Sun,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  loadOrganisations,
  signOut,
  switchOrganisation,
  type AppSession,
  type OrganisationMembership,
} from "@/lib/naba-presence-api"
import { cn } from "@/lib/utils"

const NAV_ITEMS = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/reviews", label: "Reviews", icon: MessageSquareText },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/connections", label: "Connections", icon: Link2 },
  { href: "/settings", label: "Settings", icon: Settings },
]

export function AppShell({
  apiStatus,
  session,
  children,
}: {
  apiStatus: "loading" | "connected" | "error"
  session: AppSession | null
  children: React.ReactNode
}) {
  const organisationName = session?.organisationName ?? "Your organisation"
  const [organisations, setOrganisations] = useState<
    OrganisationMembership[]
  >([])
  const displayName = session?.displayName ?? "Account"
  const userInitials =
    displayName
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "AC"

  useEffect(() => {
    if (!session?.userId) return
    let active = true
    void loadOrganisations()
      .then(({ items }) => {
        if (active) setOrganisations(items)
      })
      .catch(() => {
        if (active) setOrganisations([])
      })
    return () => {
      active = false
    }
  }, [session?.userId])

  async function handleSignOut() {
    await signOut()
    window.location.assign("/sign-in")
  }

  async function handleOrganisationSwitch(organisationId: string) {
    if (organisationId === session?.organisationId) return
    await switchOrganisation(organisationId)
    window.location.assign("/reviews")
  }

  return (
    <SidebarProvider>
      <Sidebar variant="floating" collapsible="icon">
        <SidebarHeader className="shrink-0 gap-3 border-b border-sidebar-border/70 px-4 py-4 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-2">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <MessageSquareText className="size-4" aria-hidden />
            </span>
            <span className="flex flex-col group-data-[collapsible=icon]:hidden">
              <span className="font-heading text-base font-semibold tracking-tight">
                NabaPresence
              </span>
              <span className="text-[10px] font-medium tracking-wide text-sidebar-foreground/70">
                Nab a Presence
              </span>
            </span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start px-0 text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden"
                  aria-label={`Switch organisation, current: ${organisationName}`}
                />
              }
            >
              <Building2 className="size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-left text-xs font-medium">
                {organisationName}
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-56">
              {(organisations.length
                ? organisations
                : session
                  ? [
                      {
                        organisationId: session.organisationId,
                        name: organisationName,
                        role: session.role,
                      },
                    ]
                  : []
              ).map((organisation) => (
                <DropdownMenuItem
                  key={organisation.organisationId}
                  onClick={() =>
                    handleOrganisationSwitch(organisation.organisationId)
                  }
                >
                  <Building2 aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    {organisation.name}
                  </span>
                  <span className="text-xs capitalize text-muted-foreground">
                    {organisation.role}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarHeader>
        <SidebarContent>
          <ShellNav />
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border/70">
          <div className="flex items-center gap-3 px-2 py-1.5">
            <Avatar size="sm">
              <AvatarFallback>{userInitials}</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
              <span className="truncate text-sm font-medium">
                {displayName}
              </span>
              <span className="truncate text-xs text-muted-foreground capitalize">
                {session?.role ?? "member"}
              </span>
            </div>
          </div>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Sign out"
                onClick={handleSignOut}
              >
                <LogOut aria-hidden />
                <span>Sign out</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="flex h-14 shrink-0 items-center gap-3 bg-transparent px-4 md:px-6">
          <SidebarTrigger aria-label="Toggle navigation" />
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-xs text-muted-foreground lg:flex">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  apiStatus === "connected"
                    ? "bg-success"
                    : apiStatus === "loading"
                      ? "bg-rating"
                      : "bg-muted-foreground"
                )}
              />
              {apiStatus === "connected"
                ? "Live data"
                : apiStatus === "loading"
                  ? "Checking live data"
                  : "Live data unavailable"}
            </div>
            <ThemeToggle />
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}

function ShellNav() {
  const { setOpenMobile } = useSidebar()
  const pathname = usePathname()
  return (
    <nav aria-label="Primary">
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const isActive =
                pathname === item.href || pathname.startsWith(`${item.href}/`)
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    render={<Link href={item.href} />}
                    aria-label={item.label}
                    aria-current={isActive ? "page" : undefined}
                    isActive={isActive}
                    onClick={() => setOpenMobile(false)}
                  >
                    <Icon aria-hidden />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </nav>
  )
}

function ThemeToggle() {
  const { setTheme } = useTheme()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Change theme" />
        }
      >
        <Sun className="dark:hidden" aria-hidden />
        <Moon className="hidden dark:block" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-32">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
