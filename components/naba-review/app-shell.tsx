"use client"

import {
  BarChart3,
  Building2,
  LayoutDashboard,
  Link2,
  MessageSquareText,
  Moon,
  Settings,
  Sun,
  UtensilsCrossed,
} from "lucide-react"
import { useTheme } from "next-themes"

import { type View } from "@/components/naba-review/shared"
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
import { cn } from "@/lib/utils"
import { type AppSession } from "@/lib/naba-review-api"

const NAV_ITEMS: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "reviews", label: "Reviews", icon: MessageSquareText },
  { id: "menu", label: "Menu assistant", icon: UtensilsCrossed },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "connections", label: "Connections", icon: Link2 },
  { id: "settings", label: "Settings", icon: Settings },
]

export function AppShell({
  activeView,
  onNavigate,
  apiStatus,
  session,
  children,
}: {
  activeView: View
  onNavigate: (view: View) => void
  apiStatus: "loading" | "connected" | "error"
  session: AppSession | null
  children: React.ReactNode
}) {
  const organisationName = session?.organisationName ?? "Your organisation"
  const displayName = session?.displayName ?? "Account"
  const userInitials =
    displayName
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "AC"

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="h-16 shrink-0 justify-center border-b px-4">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <MessageSquareText className="size-4" aria-hidden />
            </span>
            <span className="font-heading text-base font-semibold tracking-tight">
              NabaReview
            </span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <ShellNav activeView={activeView} onNavigate={onNavigate} />
        </SidebarContent>
        <SidebarFooter className="border-t">
          <div className="flex items-center gap-3 px-2 py-1.5">
            <Avatar size="sm">
              <AvatarFallback>{userInitials}</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">{displayName}</span>
              <span className="truncate text-xs text-muted-foreground capitalize">
                {session?.role ?? "member"}
              </span>
            </div>
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-background px-4 md:px-6">
          <SidebarTrigger aria-label="Toggle navigation" />
          <div className="hidden min-w-0 items-center gap-2 md:flex">
            <Building2 className="size-4 text-muted-foreground" aria-hidden />
            <span className="truncate text-sm font-medium">{organisationName}</span>
          </div>
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
            <Avatar size="sm">
              <AvatarFallback>{userInitials}</AvatarFallback>
            </Avatar>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}

function ShellNav({
  activeView,
  onNavigate,
}: {
  activeView: View
  onNavigate: (view: View) => void
}) {
  const { setOpenMobile } = useSidebar()
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            return (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton
                  isActive={activeView === item.id}
                  onClick={() => {
                    onNavigate(item.id)
                    setOpenMobile(false)
                  }}
                >
                  <Icon aria-hidden />
                  {item.label}
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
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
        <DropdownMenuItem onClick={() => setTheme("light")}>Light</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>Dark</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>System</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
