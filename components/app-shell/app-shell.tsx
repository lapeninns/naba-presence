"use client"

import { LogOut, Menu, Store } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { signOut } from "@/lib/api/auth"
import { useConnectionHealth } from "@/lib/queries/use-connection-health"

import { Nav } from "./nav"
import { StatusChip } from "./status-chip"
import { ThemeToggle } from "./theme-toggle"

// `Session` (lib/server/session) lives behind a `server-only` import gate,
// so this client component can't reference it directly. `ShellSession`
// mirrors its fields exactly — the dashboard layout hands its server
// `Session` object straight to this prop, and structural typing accepts it
// without a cast.
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

function initialsFor(name: string) {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
  return letters || "AC"
}

async function handleSignOut() {
  try {
    await signOut()
  } finally {
    // Leave regardless: a failed clear is recoverable server-side, but a user
    // stuck on a dashboard they believe they have left is not.
    window.location.assign("/sign-in")
  }
}

// The click handler fires `handleSignOut` without awaiting it (a button
// click can't await), so a rejection from `signOut()` — already handled by
// `handleSignOut`'s own `finally` above — would otherwise surface as an
// unhandled promise rejection. This catch exists only to close that gap;
// the navigation itself already happened by the time it runs.
function handleSignOutClick() {
  handleSignOut().catch(() => {})
}

/**
 * Announces `useConnectionHealth`'s label change to assistive tech — but
 * only on a CHANGE. The first REAL label a mount ever observes (whatever it
 * happens to be) must stay silent, or every page load would open with a
 * spoken status. "loading" doesn't count as that first real label - it's a
 * transient tick nearly every mount passes through on the way to a real
 * status (there's rarely SSR-hydrated query data once `useSessionReady`
 * gates this component's own mount), so treating it as the baseline would
 * make the very next tick - the first real status - look like a "change"
 * and announce on every page load, exactly what this hook exists to avoid.
 * The announcement text deliberately differs from the bare label so it
 * never collides with StatusChip's own visible-at-sm label: two elements
 * exposing the exact same accessible text would make `getByText`/
 * screen-reader "next item" navigation ambiguous.
 */
function useStatusAnnouncement() {
  const { status, label } = useConnectionHealth()
  const [announcement, setAnnouncement] = useState("")
  const previousLabelRef = useRef<string | null>(null)

  useEffect(() => {
    if (status === "loading") return
    const previousLabel = previousLabelRef.current
    if (previousLabel !== null && previousLabel !== label) {
      setAnnouncement(`Connections status: ${label}`)
    }
    previousLabelRef.current = label
  }, [status, label])

  return announcement
}

// Bundles the status chip's live-region announcer so its hook - and
// therefore `useConnectionHealth`'s query - only mounts once a session
// cookie is known to exist (see `useSessionReady` below).
function ConnectionAnnouncer() {
  const announcement = useStatusAnnouncement()
  return (
    <div aria-live="polite" className="sr-only">
      {announcement}
    </div>
  )
}

/**
 * A session cookie is required before `useConnectionHealth`'s query can
 * succeed against `/api/google/connections`. The dashboard layout can only
 * ever READ a cookie (`getSession`) - Next.js forbids setting one from a
 * plain Server Component, only a Server Action or Route Handler may do that
 * - so on the very first anonymous visit (local/dev bootstrap, no cookie
 * yet) `session` arrives here `null` even though access is allowed.
 *
 * If the connections query were allowed to run in that gap, it would 401,
 * and the API client treats a 401 with code `authentication_required` as
 * "sign in again" and hard-navigates to `/sign-in` - a route this milestone
 * doesn't have. So: hit the session
 * Route Handler once on mount to provision the cookie first (mirroring the
 * pre-rebuild dashboard's `loadSession()` bootstrap), and only report ready
 * once that settles. Nothing here runs when a real session already exists.
 */
function useSessionReady(session: ShellSession | null) {
  const [ready, setReady] = useState(session !== null)

  useEffect(() => {
    if (session) return
    let cancelled = false
    fetch("/api/session", { credentials: "same-origin" })
      .catch(() => {
        // Swallow: if bootstrap genuinely fails, letting the gated query
        // mount anyway surfaces the real error state instead of hanging.
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [session])

  return ready
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

  const organisationName = session?.organisationName ?? "Your organisation"
  const displayName = session?.displayName ?? "Account"

  return (
    <div className="min-h-svh md:flex">
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:top-3 focus-visible:left-3 focus-visible:z-50 focus-visible:rounded-(--nr-radius-control) focus-visible:bg-primary focus-visible:px-3 focus-visible:py-2 focus-visible:text-ui focus-visible:font-medium focus-visible:text-primary-foreground focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
      >
        Skip to content
      </a>

      <aside className="hidden shrink-0 md:m-(--nr-sidebar-margin) md:flex md:w-(--nr-sidebar-width) md:flex-col md:overflow-hidden md:rounded-(--nr-radius-shell) md:border md:border-sidebar-border md:bg-sidebar md:text-sidebar-foreground md:shadow-(--nr-shadow-float)">
        <div className="flex shrink-0 items-center gap-2.5 border-b border-sidebar-border/70 px-4 py-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-(--nr-radius-control) bg-primary text-primary-foreground">
            <Store className="size-4" aria-hidden />
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-title font-semibold tracking-tight">
              NabaPresence
            </span>
            <span className="truncate text-caption font-medium text-sidebar-foreground/70">
              {organisationName}
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          <Nav />
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-sidebar-border/70 px-4 py-3">
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground"
          >
            {initialsFor(displayName)}
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-ui font-medium">
              {displayName}
            </span>
            {session ? (
              <span className="truncate text-caption text-sidebar-foreground/70 capitalize">
                {session.role}
              </span>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Sign out"
            onClick={handleSignOutClick}
          >
            <LogOut aria-hidden />
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 px-5 md:px-(--nr-page-pad-x)">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-sm"
                  className="md:hidden"
                  aria-label="Open navigation"
                />
              }
            >
              <Menu aria-hidden />
            </SheetTrigger>
            <SheetContent
              side="left"
              className="data-[side=left]:w-64 bg-sidebar text-sidebar-foreground"
            >
              <SheetHeader className="sr-only">
                <SheetTitle>Navigation</SheetTitle>
                <SheetDescription>
                  Primary navigation for NabaPresence.
                </SheetDescription>
              </SheetHeader>
              <div className="px-2 py-4">
                <Nav onNavigate={() => setMobileNavOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>

          <div className="ml-auto flex items-center gap-2">
            {sessionReady ? <StatusChip /> : null}
            <ThemeToggle />
          </div>
        </header>

        {sessionReady ? <ConnectionAnnouncer /> : null}

        {children}
      </div>
    </div>
  )
}

export { AppShell }
