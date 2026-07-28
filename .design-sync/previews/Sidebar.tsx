import {
  Badge,
  Separator,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from "NabaReview"
import {
  BarChart3,
  Building2,
  Inbox,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Star,
} from "lucide-react"

// SidebarProvider is required (useSidebar throws without it) and is composed
// here inside the preview. Two provider defaults have to be overridden for a
// card: min-h-svh (replaced with min-h-0 + a fixed height) and w-full.
//
// collapsible="none" is deliberate. The offcanvas/icon branches render the
// sidebar in a `fixed inset-y-0 h-svh` container behind a `hidden md:block`
// gate, so in a card they either escape the frame or vanish below 768px;
// collapsible="none" renders the same parts in normal flow at
// --sidebar-width (16rem).

export function ReviewOperationsShell() {
  return (
    <SidebarProvider className="h-96 min-h-0 w-full max-w-3xl overflow-hidden rounded-2xl border border-border">
      <Sidebar collapsible="none" className="border-r border-sidebar-border">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1">
            <div className="flex size-6 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Building2 className="size-3.5" aria-hidden />
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">Lapen Inns</span>
              <span className="truncate text-[11px] text-sidebar-foreground/70">
                3 locations
              </span>
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive>
                    <Inbox aria-hidden />
                    <span>Reviews</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge>16</SidebarMenuBadge>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <MapPin aria-hidden />
                    <span>Locations</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <BarChart3 aria-hidden />
                    <span>Reports</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <Settings aria-hidden />
                    <span>Settings</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg">
                <div className="flex size-6 items-center justify-center rounded-xl bg-muted text-[11px] font-medium">
                  LF
                </div>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm">Lena Fischer</span>
                  <span className="truncate text-[11px] text-sidebar-foreground/70">
                    Reply owner
                  </span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <span className="truncate text-sm font-medium">Reviews &mdash; Central</span>
          <Badge variant="secondary" className="ml-auto">
            12 awaiting reply
          </Badge>
        </header>
        <div className="flex min-w-0 flex-col">
          {[
            { name: "Lena Fischer", rating: 2, age: "5d", status: "Escalated" },
            { name: "Tom Okafor", rating: 4, age: "3d", status: "Awaiting reply" },
            { name: "Priya Sharma", rating: 5, age: "2d", status: "Replied" },
            { name: "Marco Silva", rating: 5, age: "1w", status: "Replied" },
          ].map((r) => (
            <div
              key={r.name}
              className="flex items-center gap-3 border-b border-border px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.name}</span>
              <span className="inline-flex items-center gap-0.5" aria-hidden>
                {[1, 2, 3, 4, 5].map((i) => (
                  <Star
                    key={i}
                    className={
                      i <= r.rating
                        ? "size-3 fill-rating text-rating"
                        : "size-3 text-muted-foreground/40"
                    }
                  />
                ))}
              </span>
              <span
                className={
                  r.status === "Escalated"
                    ? "w-24 truncate text-xs text-destructive"
                    : r.status === "Replied"
                      ? "w-24 truncate text-xs text-success"
                      : "w-24 truncate text-xs text-muted-foreground"
                }
              >
                {r.status}
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">{r.age}</span>
            </div>
          ))}
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border px-3 py-2">
          <span className="text-xs text-muted-foreground">
            Showing <span className="font-mono">4</span> of{" "}
            <span className="font-mono">64</span> &middot; last 90 days
          </span>
          <span className="text-xs text-success">Synced 09:41</span>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

export function PerLocationNavigation() {
  return (
    <SidebarProvider className="h-96 min-h-0 w-fit overflow-hidden rounded-2xl border border-border">
      <Sidebar collapsible="none">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Locations</SidebarGroupLabel>
            <SidebarGroupAction aria-label="Add location">
              <Plus aria-hidden />
            </SidebarGroupAction>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive>
                    <MapPin aria-hidden />
                    <span>Central</span>
                  </SidebarMenuButton>
                  <SidebarMenuAction aria-label="Central options">
                    <MoreHorizontal aria-hidden />
                  </SidebarMenuAction>
                  <SidebarMenuSub>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton isActive>
                        <span>Reviews</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton>
                        <span>Photos</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton>
                        <span>Questions</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                </SidebarMenuItem>

                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <MapPin aria-hidden />
                    <span>Riverside</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge>4</SidebarMenuBadge>
                </SidebarMenuItem>

                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <MapPin aria-hidden />
                    <span>Airport</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarSeparator />

          <SidebarGroup>
            <SidebarGroupLabel>Queues</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton size="sm">
                    <MessageSquare aria-hidden />
                    <span>Unanswered</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge>16</SidebarMenuBadge>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton size="sm">
                    <ShieldCheck aria-hidden />
                    <span>Escalated</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge>2</SidebarMenuBadge>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  )
}

export function SearchAndAccount() {
  return (
    <SidebarProvider className="h-80 min-h-0 w-fit overflow-hidden rounded-2xl border border-border">
      <Sidebar collapsible="none">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1">
            <div className="flex size-6 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Building2 className="size-3.5" aria-hidden />
            </div>
            <span className="truncate text-sm font-medium">NabaReview</span>
          </div>
          <div className="relative px-1">
            <Search
              className="absolute top-2.5 left-3 size-3.5 text-sidebar-foreground/70"
              aria-hidden
            />
            <SidebarInput placeholder="Search reviews" className="pl-8" />
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Reports</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <BarChart3 aria-hidden />
                    <span>Response rate</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive>
                    <Star aria-hidden />
                    <span>Rating trend</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <SidebarSeparator />
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg">
                <div className="flex size-6 items-center justify-center rounded-xl bg-muted text-[11px] font-medium">
                  MS
                </div>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm">Marco Silva</span>
                  <span className="truncate text-[11px] text-sidebar-foreground/70">
                    Airport &middot; admin
                  </span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
    </SidebarProvider>
  )
}
