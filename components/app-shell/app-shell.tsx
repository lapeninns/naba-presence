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
import { ReconnectBanner } from "./reconnect-banner"
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
  } catch {
    // Best-effort: a failed clear is recoverable server-side, but a user
    // stranded on a dashboard they believe they have left is not.
  } finally {
    window.location.assign("/sign-in")
  }
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
 * A session cookie is required before any protected query - not just
 * `useConnectionHealth`'s `/api/google/connections`, but every per-route
 * fetch a page's own content makes, e.g. Home's `useReviewCounts` /
 * `useAnalyticsOverview` - can succeed. The dashboard layout can only ever
 * READ a cookie (`getSession`) - Next.js forbids setting one from a plain
 * Server Component, only a Server Action or Route Handler may do that - so
 * on the very first anonymous visit (local/dev bootstrap, no cookie yet)
 * `session` arrives here `null` even though access is allowed.
 *
 * If those queries were allowed to run in that gap, they would 401, and the
 * API client treats a 401 with code `authentication_required` as "sign in
 * again" and hard-navigates to `/sign-in` - a route this milestone doesn't
 * have (it would also fail the e2e console-error guard even where the UI
 * recovers, since the first, doomed attempt still logs to the console). So:
 * hit the session Route Handler once on mount to provision the cookie first
 * (mirroring the pre-rebuild dashboard's `loadSession()` bootstrap), and
 * only report ready - and only then mount the status chip, the announcer,
 * and the routed page content itself - once that settles. Nothing here
 * runs when a real session already exists.
 */
function useSessionReady(session: ShellSession | null) {
  const [ready, setReady] = useState(session !== null)

  useEffect(() => {
    if (session) return
    let cancelled = false
    const controller = new AbortController()
    // Guard against a hung bootstrap request stranding the shell on a blank
    // gate: abort after 5s and let the gated queries mount (they surface the
    // real error state rather than hanging).
    const timeout = setTimeout(() => controller.abort(), 5000)
    fetch("/api/session", {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .catch(() => {
        // Swallow: abort or network failure both fall through to ready=true.
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

function AppShell({
  session,
  multiLocation = false,
  children,
}: {
  session: ShellSession | null
  // Resolved server-side in app/(dashboard)/layout.tsx, so the Locations item
  // is right on the first paint and never flickers in or out.
  multiLocation?: boolean
  children: React.ReactNode
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const sessionReady = useSessionReady(session)

  const organisationName = session?.organisationName ?? "Your organisation"
  const displayName = session?.displayName ?? "Account"

  return (
    // `h-svh` (not `min-h-svh`): the shell is viewport-locked so expanding
    // content (e.g. inbox Activity) scrolls inside its pane instead of
    // stretching the nav sidebar along with the page.
    <div className="h-svh md:flex">
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
          <Nav multiLocation={multiLocation} />
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
            onClick={handleSignOut}
          >
            <LogOut aria-hidden />
          </Button>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
                <Nav
                  multiLocation={multiLocation}
                  onNavigate={() => setMobileNavOpen(false)}
                />
              </div>
            </SheetContent>
          </Sheet>

          <div className="ml-auto flex items-center gap-2">
            {sessionReady ? <StatusChip /> : null}
            <ThemeToggle />
          </div>
        </header>

        {sessionReady ? <ConnectionAnnouncer /> : null}
        {sessionReady ? <ReconnectBanner /> : null}

        {/* Scroll here for ordinary pages; workspace frames (`h-full`) fill
            this box and scroll internally so the nav sidebar never grows. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {sessionReady ? children : null}
        </div>
      </div>
    </div>
  )
}

export { AppShell }
