"use client"

import { Dialog } from "@base-ui/react/dialog"
import { useQuery } from "@tanstack/react-query"
import { XIcon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { BrandMark } from "@/components/app-shell/brand-mark"
import { TooltipProvider } from "@/components/ui/tooltip"
import { fetchReviewCounts } from "@/lib/api/review-counts"
import { fetchSession } from "@/lib/api/session"
import { useMediaQuery } from "@/lib/hooks/use-media-query"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
import { useClients } from "@/lib/queries/use-clients"
import { cn } from "@/lib/utils"

import { AccountMenu } from "./account-menu"
import { ClientScopeRoot } from "./client-context"
import { Nav } from "./nav"
import { ReconnectBanner } from "./reconnect-banner"
import { ShellOAuthReturn } from "./shell-oauth-return"
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

/**
 * The Inbox's needs-reply count for the sidebar badge.
 *
 * The same organisation-wide `/api/reviews/counts` read the Inbox's queue
 * controls make, under the same key, so the badge and the Needs reply queue
 * never disagree. Always a background request: a badge is not worth a
 * sign-in redirect, so a 401 here just leaves the badge off.
 */
function useNeedsReplyCount() {
  const counts = useQuery({
    queryKey: queryKeys.reviewCounts("organisation"),
    queryFn: ({ signal }) =>
      fetchReviewCounts({}, { signal, background: true }),
    refetchInterval: 60_000,
    retry: false,
  })
  return counts.data?.byQueue.needs_reply
}

/** Reads the client list the sidebar pins beneath Clients. */
function SidebarNav({
  onNavigate,
  layout,
  rail,
}: {
  onNavigate?: () => void
  layout: "full" | "responsive"
  rail: boolean
}) {
  const clients = useClients()
  const needsReply = useNeedsReplyCount()
  return (
    <Nav
      onNavigate={onNavigate}
      layout={layout}
      rail={rail}
      needsReply={needsReply}
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
 * The sidebar's three parts (the organisation at the top, the navigation
 * that scrolls, the account row at the bottom) shared by the persistent
 * column and the phone sheet so the two never disagree.
 *
 * `responsive` draws the persistent column: the full 240px sidebar above
 * 1180px, the 64px icon rail from 768 to 1180. `full` is the sheet.
 */
function SidebarBody({
  session,
  sessionReady,
  organisationName,
  onNavigate,
  layout,
  rail = false,
  closeButton,
}: {
  session: ShellSession | null
  sessionReady: boolean
  organisationName: string | null
  onNavigate?: () => void
  layout: "full" | "responsive"
  rail?: boolean
  closeButton?: React.ReactNode
}) {
  const responsive = layout === "responsive"
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 pr-2">
        <Link
          href="/inbox"
          onClick={onNavigate}
          className={cn(
            "m-1 flex min-w-0 flex-1 items-center rounded-md px-3 pt-4 pb-3 focus-halo focus-visible:outline-none",
            responsive && "md:max-[1181px]:justify-center md:max-[1181px]:px-0"
          )}
        >
          <BrandMark
            title={
              organisationName ?? (
                // A span, not <Skeleton>: this sits inside phrasing content.
                <span
                  aria-hidden
                  data-slot="skeleton"
                  className="inline-block h-3.5 w-28 rounded-(--np-radius-tag) bg-fill align-middle"
                />
              )
            }
            subtitle="NabaPresence"
            textClassName={cn(responsive && "md:max-[1181px]:sr-only")}
          />
        </Link>
        {closeButton}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-3">
        {sessionReady ? (
          <SidebarNav onNavigate={onNavigate} layout={layout} rail={rail} />
        ) : null}
      </div>

      <div className="shrink-0 border-t border-line p-2">
        <AccountMenu session={session} rail={responsive} />
      </div>
    </div>
  )
}

/**
 * The phone navigation: a left drawer (min(300px, 86vw)) over a scrim.
 *
 * Built on the dialog primitive directly rather than the shared Sheet, which
 * is a bottom sheet below 768px; navigation slides in from the edge the
 * sidebar lives on. The primitive supplies the modal behaviour: focus is
 * trapped inside, Escape and a scrim click close it, the page behind stops
 * scrolling, and focus returns to the menu button.
 */
function NavigationSheet({
  open,
  onOpenChange,
  toggleRef,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  toggleRef: React.RefObject<HTMLButtonElement | null>
  children: (closeButton: React.ReactNode) => React.ReactNode
}) {
  const popupRef = useRef<HTMLDivElement>(null)
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-scrim transition-opacity duration-(--np-duration-standard) data-ending-style:opacity-0 data-starting-style:opacity-0 md:hidden" />
        <Dialog.Popup
          ref={popupRef}
          id="mobile-navigation"
          aria-label="Navigation"
          initialFocus={() =>
            popupRef.current?.querySelector<HTMLElement>(
              'nav a[aria-current="page"]'
            ) ?? true
          }
          finalFocus={toggleRef}
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex w-[min(300px,86vw)] flex-col bg-surface text-ink shadow-np-pop outline-none md:hidden",
            "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
            "transition-transform duration-(--np-duration-standard) ease-out-strong data-ending-style:-translate-x-full data-starting-style:-translate-x-full"
          )}
        >
          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          <Dialog.Description className="sr-only">
            Primary navigation for NabaPresence.
          </Dialog.Description>
          {children(
            <Dialog.Close
              aria-label="Close navigation"
              className="grid size-11 shrink-0 place-items-center rounded-md text-ink-muted focus-halo transition-colors hover:bg-fill hover:text-ink focus-visible:outline-none"
            >
              <XIcon className="size-5" strokeWidth={1.75} aria-hidden />
            </Dialog.Close>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/**
 * The three-part window: the sidebar (or rail), a toolbar the content
 * scrolls beneath, and the content column.
 *
 * The toolbar is sticky INSIDE the scroll column rather than a sibling above
 * it, which is what lets the page pass under it. Ordinary pages scroll the
 * column; workspace frames lock to the viewport and scroll their own panes,
 * so the sidebar never grows.
 */
function AppShell({
  session,
  children,
}: {
  session: ShellSession | null
  children: React.ReactNode
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const navToggleRef = useRef<HTMLButtonElement>(null)
  const sessionReady = useSessionReady(session)
  // The layout hydrates this key from the same server session, so a signed-in
  // first paint already has the real name. Reading the query (not only the
  // prop) is what lets a rename in Settings show here at once, and what fills
  // the name in after the local anonymous bootstrap. Until a name is known the
  // sidebar draws a skeleton rather than a placeholder that then changes.
  const liveSession = useQuery({
    queryKey: queryKeys.session,
    queryFn: (ctx) => fetchSession(requestOptions(ctx)),
    enabled: sessionReady,
  }).data?.session
  const organisationName =
    liveSession?.organisationName ?? session?.organisationName ?? null
  const pathname = usePathname()
  const rail = useMediaQuery(
    "(min-width: 768px) and (max-width: 1180.98px)",
    false
  )
  const wide = useMediaQuery("(min-width: 768px)", false)

  // Any route change closes the sheet, whether it came from a nav row, the
  // command palette or the browser's back button. The previous path is held
  // in state so the close happens during render, not in a follow-up effect.
  const [lastPath, setLastPath] = useState(pathname)
  if (lastPath !== pathname) {
    setLastPath(pathname)
    if (mobileNavOpen) setMobileNavOpen(false)
  }
  // Growing past 768px turns the sheet into the persistent rail; a sheet left
  // open underneath would still hold focus and the scroll lock.
  if (wide && mobileNavOpen) setMobileNavOpen(false)

  return (
    // One provider for the whole shell so toolbar and rail tooltips share a
    // delay and open instantly when the pointer moves between neighbours.
    // `h-svh`, not `min-h-svh`: the shell is viewport-locked so expanding
    // content scrolls inside its own column instead of stretching the sidebar.
    <TooltipProvider>
      <ClientScopeRoot>
        <div className="flex h-svh bg-canvas text-ink">
          <a
            href="#main"
            className="fixed top-[-60px] left-3 z-[100] rounded-full bg-primary px-4 py-2 text-ui font-semibold text-primary-foreground no-underline focus:top-3 focus:shadow-np-pop focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Skip to content
          </a>

          <aside
            aria-label="Sidebar"
            className="hidden w-(--np-rail-width) shrink-0 flex-col overflow-hidden bg-canvas shadow-[inset_-1px_0_0_var(--np-line)] min-[1181px]:w-(--np-sidebar-width) md:flex"
          >
            <SidebarBody
              session={session}
              sessionReady={sessionReady}
              organisationName={organisationName}
              layout="responsive"
              rail={rail}
            />
          </aside>

          <NavigationSheet
            open={mobileNavOpen}
            onOpenChange={setMobileNavOpen}
            toggleRef={navToggleRef}
          >
            {(closeButton) => (
              <SidebarBody
                session={session}
                sessionReady={sessionReady}
                organisationName={organisationName}
                layout="full"
                onNavigate={() => setMobileNavOpen(false)}
                closeButton={closeButton}
              />
            )}
          </NavigationSheet>

          {/* The scroll column. The toolbar sticks to its top and the page
            passes beneath it; a workspace frame fills the remainder. */}
          <div className="flex min-h-0 min-w-0 flex-1 scroll-pt-[calc(var(--np-toolbar-h)+8px)] flex-col overflow-x-hidden overflow-y-auto">
            <Topbar
              onOpenNav={() => setMobileNavOpen(true)}
              navOpen={mobileNavOpen}
              navToggleRef={navToggleRef}
              sessionReady={sessionReady}
              className="sticky top-0 z-30"
            />

            {sessionReady ? <ReconnectBanner /> : null}
            {sessionReady ? <ShellOAuthReturn /> : null}

            <div className="flex min-h-0 flex-1 flex-col">
              {sessionReady ? children : null}
            </div>
          </div>
        </div>
      </ClientScopeRoot>
    </TooltipProvider>
  )
}

export { AppShell }
