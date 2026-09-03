"use client"

import { useEffect, useState } from "react"

import { BrandMark } from "@/components/app-shell/brand-mark"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { useClients } from "@/lib/queries/use-clients"

import { AccountMenu } from "./account-menu"
import { BreadcrumbsProvider } from "./breadcrumbs-context"
import { Nav } from "./nav"
import { ReconnectBanner } from "./reconnect-banner"
import { Topbar } from "./topbar"

// `Session` (lib/server/session) lives behind a `server-only` import gate, so
// this client component can't reference it directly. `ShellSession` mirrors
// its fields exactly — the dashboard layout hands its server `Session` object
// straight to this prop, and structural typing accepts it without a cast.
export type ShellSession = {
  sessionId: string
  userId: string
  organisationId: string
  organisationName: string
  displayName: string
  email: string
  role: "owner" | "admin" | "member" | "viewer"
  canPublish: boolean
}

/**
 * A session cookie is required before any protected query can succeed. The
 * dashboard layout can only READ a cookie (Next forbids setting one from a
 * plain Server Component), so on the very first anonymous visit (local/dev
 * bootstrap) `session` arrives null even though access is allowed. Hit the
 * session route once to provision the cookie, and gate the routed content
 * until it settles, or every page's first fetch would 401 and hard-navigate
 * to /sign-in. Nothing here runs when a real session already exists.
 */
function useSessionReady(session: ShellSession | null) {
  const [ready, setReady] = useState(session !== null)

  useEffect(() => {
    if (session) return
    let cancelled = false
    const controller = new AbortController()
    // Guard against a hung bootstrap stranding the shell on a blank gate.
    const timeout = setTimeout(() => controller.abort(), 5000)
    fetch("/api/session", {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .catch(() => {
        // Abort or network failure both fall through to ready=true; the gated
        // queries then surface the real error rather than hanging.
      })
      .finally(() => {
        clearTimeout(timeout)
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
      clearTimeout(timeout)
      controller.abort()
    }
  }, [session])

  return ready
}

/** Reads the client list the sidebar pins beneath Clients. */
function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const clients = useClients()
  return (
    <Nav
      onNavigate={onNavigate}
      clients={
        clients.data?.items.map((client) => ({
          id: client.id,
          name: client.name,
          health: client.health,
        })) ?? []
      }
    />
  )
}

function AppShell({
  session,
  children,
}: {
  session: ShellSession | null
  children: React.ReactNode
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const sessionReady = useSessionReady(session)
  const organisationName = session?.organisationName ?? "Your agency"

  return (
    // `h-svh`, not `min-h-svh`: the shell is viewport-locked so expanding
    // content scrolls inside its own pane instead of stretching the sidebar.
    <BreadcrumbsProvider>
      <div className="h-svh md:flex">
        <a
          href="#main"
          className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:top-3 focus-visible:left-3 focus-visible:z-50 focus-visible:rounded-(--np-radius-control) focus-visible:bg-primary focus-visible:px-3 focus-visible:py-2 focus-visible:text-ui focus-visible:font-medium focus-visible:text-primary-foreground focus-visible:outline-none"
        >
          Skip to content
        </a>

        <aside className="hidden shrink-0 border-r border-line bg-sidebar text-sidebar-foreground md:flex md:w-(--np-sidebar-width) md:flex-col md:overflow-hidden">
          <div className="flex shrink-0 items-center gap-2.5 px-4 py-4">
            <BrandMark size="sm" subtitle={organisationName} />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {sessionReady ? <SidebarNav /> : null}
          </div>

          <div className="shrink-0 border-t border-line-subtle p-2">
            <AccountMenu session={session} />
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <Topbar onOpenNav={() => setMobileNavOpen(true)} />

          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetContent
              side="left"
              className="bg-sidebar text-sidebar-foreground data-[side=left]:w-72"
            >
              <SheetHeader className="sr-only">
                <SheetTitle>Navigation</SheetTitle>
                <SheetDescription>
                  Primary navigation for NabaPresence.
                </SheetDescription>
              </SheetHeader>
              <div className="flex h-full flex-col">
                <div className="px-4 py-4">
                  <BrandMark size="sm" subtitle={organisationName} />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-2">
                  {sessionReady ? (
                    <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
                  ) : null}
                </div>
                <div className="border-t border-line-subtle p-2">
                  <AccountMenu session={session} />
                </div>
              </div>
            </SheetContent>
          </Sheet>

          {sessionReady ? <ReconnectBanner /> : null}

          {/* Scroll here for ordinary pages; workspace frames (`h-full`) fill
              this box and scroll internally so the sidebar never grows. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {sessionReady ? children : null}
          </div>
        </div>
      </div>
    </BreadcrumbsProvider>
  )
}

export { AppShell }
