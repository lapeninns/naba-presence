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
import { TooltipProvider } from "@/components/ui/tooltip"
import { useClients } from "@/lib/queries/use-clients"

import { AccountMenu } from "./account-menu"
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

/**
 * The sidebar's three parts — the organisation at the top, the navigation
 * that scrolls, the account row at the bottom — shared by the persistent
 * desktop column and the mobile sheet so the two never disagree.
 */
function SidebarBody({
  session,
  sessionReady,
  organisationName,
  onNavigate,
}: {
  session: ShellSession | null
  sessionReady: boolean
  organisationName: string
  onNavigate?: () => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center px-4 pt-4 pb-3">
        <BrandMark size="sm" title={organisationName} subtitle="NabaPresence" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
        {sessionReady ? <SidebarNav onNavigate={onNavigate} /> : null}
      </div>

      <div className="shrink-0 p-2">
        <AccountMenu session={session} />
      </div>
    </div>
  )
}

/**
 * The Mac-style three-part window: a translucent sidebar, a toolbar the
 * content scrolls beneath, and the content column.
 *
 * The toolbar is sticky INSIDE the scroll column rather than a sibling above
 * it, which is what lets the page pass under its material. Ordinary pages
 * scroll the column; workspace frames (`h-full`) fill the box left beneath
 * the toolbar and scroll their own panes, so the sidebar never grows.
 */
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
    // One provider for the whole shell so toolbar and row tooltips share a
    // delay and open instantly when the pointer moves between neighbours.
    // `h-svh`, not `min-h-svh`: the shell is viewport-locked so expanding
    // content scrolls inside its own pane instead of stretching the sidebar.
    <TooltipProvider>
    <div className="flex h-svh bg-canvas text-ink">
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:top-3 focus-visible:left-3 focus-visible:z-50 focus-visible:flex focus-visible:h-(--np-control-h) focus-visible:items-center focus-visible:rounded-(--np-radius-pill) focus-visible:bg-primary focus-visible:px-4 focus-visible:text-ui focus-visible:font-medium focus-visible:text-primary-foreground focus-visible:shadow-(--np-shadow-pop) focus-visible:outline-none"
      >
        Skip to content
      </a>

      <aside className="hidden w-(--np-sidebar-width) shrink-0 material-sidebar [box-shadow:inset_-0.5px_0_0_var(--np-line)] md:flex md:flex-col md:overflow-hidden">
        <SidebarBody
          session={session}
          sessionReady={sessionReady}
          organisationName={organisationName}
        />
      </aside>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          className="material-sidebar text-ink data-[side=left]:w-72 data-[side=left]:border-r-0 data-[side=left]:[box-shadow:inset_-0.5px_0_0_var(--np-line)]"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
            <SheetDescription>
              Primary navigation for NabaPresence.
            </SheetDescription>
          </SheetHeader>
          <SidebarBody
            session={session}
            sessionReady={sessionReady}
            organisationName={organisationName}
            onNavigate={() => setMobileNavOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* The scroll column. The toolbar sticks to its top and the page passes
          beneath the material; a workspace frame fills the remainder. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <Topbar
          onOpenNav={() => setMobileNavOpen(true)}
          sessionReady={sessionReady}
          className="sticky top-0 z-20"
        />

        {sessionReady ? (
          <ReconnectBanner className="px-5 pt-5 md:px-(--np-page-pad-x) md:pt-(--np-page-pad-y)" />
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col">
          {sessionReady ? children : null}
        </div>
      </div>
    </div>
    </TooltipProvider>
  )
}

export { AppShell }
