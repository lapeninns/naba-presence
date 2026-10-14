"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Suspense, useEffect, useMemo, useRef, useState } from "react"

import { MfaStepUpHost } from "@/components/auth/mfa-step-up-host"
import { BrandMark } from "@/components/app-shell/brand-mark"
import { TooltipProvider } from "@/components/ui/tooltip"
import { fetchSession } from "@/lib/api/session"
import { withClientScope } from "@/lib/clients/scope"
import type { NavigationContext } from "@/lib/navigation/destinations"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
import { useClients } from "@/lib/queries/use-clients"
import { useShellStatus } from "@/lib/queries/use-shell-status"
import { mediaQuery } from "@/lib/ui/breakpoints"
import { cn } from "@/lib/utils"
import type { WorkspaceMode } from "@/lib/workspace/terms"

import { AccountMenu } from "./account-menu"
import { AppBar } from "./app-bar"
import { BillingBanner } from "./billing-banner"
import { ClientScopeRoot, useRememberedClient } from "./client-context"
import { ClientScopeSheet, ClientScopeSync } from "./client-switcher"
import { CommandPalette, useCommandPalette } from "./command-palette"
import { ShellHealthAnnouncer } from "./context-health-chip"
import { ImpersonationBanner } from "./impersonation-banner"
import { MoreSheet } from "./more-sheet"
import { Nav } from "./nav"
import { PageChromeProvider } from "./page-chrome"
import { ShellReconnectBanner } from "./reconnect-banner-gate"
import { RouteFocus } from "./route-focus"
import { ShellNavigationContext } from "./shell-navigation"
import { ShellNotices } from "./shell-notices"
import { ShellOAuthReturn } from "./shell-oauth-return"
import { TabBar } from "./tab-bar"
import { Toolbar } from "./topbar"
import { useNeedsReplyCount } from "./use-needs-reply-count"

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
  workspaceMode: WorkspaceMode
  /** Set only inside a support impersonation session. */
  supportActor?: string | null
  impersonationReason?: string | null
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
function SidebarNav({
  role,
  mode,
  hideCalendar,
}: {
  role: string | null
  mode: WorkspaceMode
  hideCalendar: boolean
}) {
  const clients = useClients()
  const needsReply = useNeedsReplyCount()
  const { remembered } = useRememberedClient()
  return (
    <Nav
      role={role}
      mode={mode}
      hideCalendar={hideCalendar}
      scopeClientId={mode === "business" ? null : remembered}
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
 * The persistent column from 768px: the organisation at the top, the
 * navigation that scrolls, the account row at the bottom. One markup draws
 * both widths: the full 240px sidebar from 1180px (`wide`) and the
 * labelled rail from 768 to 1180, restyled by CSS so the first paint is
 * right on every device.
 */
function SidebarBody({
  session,
  sessionReady,
  organisationName,
  role,
  mode,
  hideCalendar,
}: {
  session: ShellSession | null
  sessionReady: boolean
  organisationName: string | null
  role: string | null
  mode: WorkspaceMode
  hideCalendar: boolean
}) {
  const { remembered } = useRememberedClient()
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Link
        href={
          mode === "business" ? "/inbox" : withClientScope("/inbox", remembered)
        }
        // The sidebar's Inbox row already prefetches on intent; the brand
        // mark is a second way to the same page.
        prefetch={false}
        className="m-1 flex min-w-0 shrink-0 items-center rounded-md px-3 pt-4 pb-3 focus-halo focus-visible:outline-none md:max-wide:justify-center md:max-wide:px-0"
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
          textClassName="md:max-wide:sr-only"
        />
      </Link>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-3 md:max-wide:px-1">
        {sessionReady ? (
          <SidebarNav role={role} mode={mode} hideCalendar={hideCalendar} />
        ) : null}
      </div>

      <div className="shrink-0 border-t border-line p-2 md:max-wide:p-1">
        <AccountMenu session={session} rail />
      </div>
    </div>
  )
}

/**
 * Closes a phone-only sheet when the viewport grows past 768px, where the
 * sheet's contents live in the rail and toolbar instead and a sheet left
 * open would still hold focus and the scroll lock. Behaviour, not layout:
 * a change listener in an effect, so nothing renders from a media query.
 */
function useCloseAtDesk(open: boolean, close: () => void) {
  const closeRef = useRef(close)
  useEffect(() => {
    closeRef.current = close
  })
  useEffect(() => {
    if (!open || typeof window.matchMedia !== "function") return
    const list = window.matchMedia(mediaQuery("md"))
    if (list.matches) {
      closeRef.current()
      return
    }
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) closeRef.current()
    }
    list.addEventListener?.("change", onChange)
    return () => list.removeEventListener?.("change", onChange)
  }, [open])
}

/**
 * The window: navigation, a header, the notices and the page, one shape
 * per width and every switch made in CSS.
 *
 * - Below 768px (phone) the DOCUMENT scrolls: a sticky app bar, the page,
 *   and a fixed bottom tab bar, so the browser chrome collapses, tapping
 *   the status bar scrolls to the top and pull-to-refresh works. The page
 *   is padded clear of the tab bar (or of a docked action bar, which takes
 *   the edge in its place).
 * - From 768px the shell is viewport-locked: the rail or sidebar, and a
 *   content column that scrolls beneath its sticky toolbar. Workspace
 *   frames take the height the column has left and scroll their own panes,
 *   so the sidebar never grows.
 *
 * The shell owns the one `<main id="main">`: the skip link's target exists
 * while a page streams, and no page can add a second.
 */
function AppShell({
  session,
  rememberedClientId = null,
  hideCalendar = false,
  children,
}: {
  session: ShellSession | null
  /**
   * The organisation's `post_scheduling` feature is off (the layout reads
   * it), so the Calendar destination is left out of the navigation.
   */
  hideCalendar?: boolean
  /**
   * The client-scope cookie as the layout read it (lib/clients/scope.ts),
   * so the navigation's links and the switcher render the same on the
   * server as on the first client pass.
   */
  rememberedClientId?: string | null
  children: React.ReactNode
}) {
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
  // The badges' and connections' one poll, for every page under the shell.
  useShellStatus(sessionReady)
  const organisationName =
    liveSession?.organisationName ?? session?.organisationName ?? null
  const role = liveSession?.role ?? session?.role ?? null
  const mode: WorkspaceMode =
    liveSession?.workspaceMode ?? session?.workspaceMode ?? "agency"
  const context = useMemo<NavigationContext>(
    () => ({ role, mode, hideCalendar }),
    [role, mode, hideCalendar]
  )

  return (
    // One provider for the whole shell so toolbar tooltips share a delay
    // and open instantly when the pointer moves between neighbours.
    <TooltipProvider>
      <ClientScopeRoot rememberedClientId={rememberedClientId}>
        <PageChromeProvider>
          <ShellNavigationContext.Provider value={context}>
            <ShellFrame
              session={session}
              sessionReady={sessionReady}
              organisationName={organisationName}
              context={context}
            >
              {children}
            </ShellFrame>
          </ShellNavigationContext.Provider>
        </PageChromeProvider>
      </ClientScopeRoot>
    </TooltipProvider>
  )
}

function ShellFrame({
  session,
  sessionReady,
  organisationName,
  context,
  children,
}: {
  session: ShellSession | null
  sessionReady: boolean
  organisationName: string | null
  context: NavigationContext
  children: React.ReactNode
}) {
  const { role, mode, hideCalendar = false } = context
  const agency = mode === "agency"
  const pathname = usePathname()
  const palette = useCommandPalette()
  const { remembered } = useRememberedClient()
  const [moreOpen, setMoreOpen] = useState(false)
  const [clientSheetOpen, setClientSheetOpen] = useState(false)
  const moreTriggerRef = useRef<HTMLButtonElement>(null)
  // Set when the More sheet closes because something in it took over (a
  // link navigated, the palette or the client sheet opened): focus then
  // goes where that leads (the new page's h1, the palette's field), not
  // back to the More tab.
  const [moreHandoff, setMoreHandoff] = useState(false)

  // Any route change closes the sheets, whether it came from a sheet row,
  // the palette or the browser's back button. The previous path is held in
  // state so the close happens during render, not in a follow-up effect.
  const [lastPath, setLastPath] = useState(pathname)
  if (lastPath !== pathname) {
    setLastPath(pathname)
    if (moreOpen) {
      setMoreHandoff(true)
      setMoreOpen(false)
    }
    if (clientSheetOpen) setClientSheetOpen(false)
  }
  useCloseAtDesk(moreOpen, () => setMoreOpen(false))
  useCloseAtDesk(clientSheetOpen, () => setClientSheetOpen(false))

  const openMore = () => {
    setMoreHandoff(false)
    setMoreOpen(true)
  }
  const handOff = (next: () => void) => {
    setMoreHandoff(true)
    setMoreOpen(false)
    next()
  }

  return (
    <div className="flex min-h-svh bg-canvas text-ink md:h-svh md:min-h-0 print:block print:h-auto print:bg-white">
      <a
        href="#main"
        className="fixed top-[-60px] left-3 z-skip-link rounded-full bg-primary px-4 py-2 text-ui font-semibold text-primary-foreground no-underline focus:top-[calc(var(--np-safe-top)+--spacing(3))] focus:shadow-np-pop focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        Skip to content
      </a>

      <aside
        aria-label="Sidebar"
        data-slot="sidebar"
        className="hidden w-(--np-rail-width) shrink-0 flex-col overflow-hidden bg-canvas shadow-np-edge-right md:flex wide:w-(--np-sidebar-width) print:hidden!"
      >
        <SidebarBody
          session={session}
          sessionReady={sessionReady}
          organisationName={organisationName}
          role={role}
          mode={mode}
          hideCalendar={hideCalendar}
        />
      </aside>

      {/* Below 768px a plain column in the document's flow (the document
          scrolls; `overflow-x-clip`, not hidden, so it does not become a
          scroll container and the app bar stays sticky to the viewport).
          From 768px the scroll column: the toolbar sticks to its top and
          the page passes beneath it. `relative` makes it the containing
          block of absolutely positioned descendants (an `sr-only` caption),
          which otherwise escape the column and make the window scroll. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-x-clip md:relative md:min-h-0 md:scroll-pt-[calc(var(--np-toolbar-h)+8px)] md:overflow-x-hidden md:overflow-y-auto print:block print:overflow-visible">
        <AppBar
          mode={mode}
          organisationName={organisationName}
          sessionReady={sessionReady}
          onOpenPalette={() => palette.setOpen(true)}
          onOpenClientScope={() => setClientSheetOpen(true)}
        />
        <Toolbar
          sessionReady={sessionReady}
          onOpenPalette={() => palette.setOpen(true)}
          className="sticky top-0 z-chrome print:hidden"
        />

        {/* Highest priority first: who is acting, the answer to an action
            just taken, then standing problems. */}
        <ShellNotices>
          {session?.supportActor ? (
            <ImpersonationBanner
              supportActor={session.supportActor}
              customerName={session.displayName}
              organisationName={session.organisationName}
            />
          ) : null}
          {sessionReady ? <ShellOAuthReturn /> : null}
          {sessionReady ? <ShellReconnectBanner /> : null}
          {sessionReady ? <BillingBanner /> : null}
        </ShellNotices>
        {sessionReady ? <MfaStepUpHost /> : null}

        <main
          id="main"
          tabIndex={-1}
          data-slot="shell-main"
          // Phones: clear of whichever bar owns the bottom edge (the tab
          // bar, or a docked action bar in its place). From 768px a
          // workspace frame inside may shrink the main to the height the
          // column has left, so its panes scroll instead of the column.
          // prettier-ignore
          className={cn(
            "flex flex-1 flex-col outline-none",
            "max-md:pb-[calc(var(--np-tabbar-h)+var(--np-safe-bottom))] max-md:[body:has([data-docked=bottom])_&]:pb-[calc(var(--np-actionbar-h)+var(--np-dock-bottom))]",
            "md:[@media(min-height:620px)]:has-[[data-width=workspace]]:min-h-0"
          )}
        >
          {sessionReady ? children : null}
        </main>
      </div>

      <TabBar
        context={context}
        scopeClientId={agency ? remembered : null}
        moreOpen={moreOpen}
        onOpenMore={openMore}
        moreTriggerRef={moreTriggerRef}
        sessionReady={sessionReady}
      />

      {sessionReady ? (
        <>
          <MoreSheet
            open={moreOpen}
            onOpenChange={(open) => (open ? openMore() : setMoreOpen(false))}
            context={context}
            session={session}
            finalFocus={!moreHandoff}
            onOpenPalette={() => handOff(() => palette.setOpen(true))}
            onOpenClientScope={() => handOff(() => setClientSheetOpen(true))}
          />
          {/* Both read the address; the boundary keeps a prerendered page
              from bailing the whole shell out to client rendering. The
              sheet switches clients then locations for an agency, and
              locations for a business; only an agency remembers a client. */}
          <Suspense fallback={null}>
            {agency ? <ClientScopeSync /> : null}
            <ClientScopeSheet
              mode={mode}
              open={clientSheetOpen}
              onOpenChange={setClientSheetOpen}
            />
          </Suspense>
          <CommandPalette
            open={palette.open}
            onOpenChange={palette.setOpen}
            hideCalendar={hideCalendar}
          />
          <ShellHealthAnnouncer />
        </>
      ) : null}
      <RouteFocus />
    </div>
  )
}

export { AppShell }
