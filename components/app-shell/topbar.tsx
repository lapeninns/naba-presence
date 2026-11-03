"use client"

import * as React from "react"
import { Suspense } from "react"

import { useWorkspaceMode } from "@/lib/workspace/mode"
import { cn } from "@/lib/utils"

import { ShellBackLink } from "./app-bar"
import { ShellBreadcrumbs, useShellBack } from "./breadcrumbs-context"
import { ScopeControlView } from "./client-switcher"
import { CommandPaletteButton } from "./command-palette"
import { NotificationsLink } from "./notifications-link"

/**
 * Where you are, on a tablet or desk: the full trail from 1180px (`wide`),
 * where it has room to be legible; between 768 and 1180 the same labelled
 * back control the phone uses, because at that width every crumb was cut
 * to a few letters.
 */
function ToolbarWayfinding() {
  const back = useShellBack()
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 items-center",
        // Reserve layout space as well as a hit target: the scope pill can
        // otherwise squeeze this flex item to zero on a tablet.
        back && "max-wide:min-w-11"
      )}
    >
      <ShellBreadcrumbs className="hidden min-w-0 flex-1 wide:flex" />
      {back ? (
        <ShellBackLink target={back} className="-ml-1 wide:hidden" />
      ) : null}
    </div>
  )
}

/**
 * The top bar: the 56px strip above the content column that the page
 * scrolls beneath, from 768px (DIRECTION §7.2). Phones get the app bar
 * instead (app-bar.tsx); the two are switched by CSS, never by a JS media
 * query.
 *
 * - Tablet (768 to 1180): the scope pill first (which client or location
 *   you are working on, with its health in words), then the back control,
 *   then search (a magnifier, a field from 1024px) and the bell.
 * - Desk (from 1180): the breadcrumbs, the search field (⌘K) and the bell.
 *   The scope lives in the sidebar's "Working on" button there.
 *
 * The page's own title is NOT here: it lives in `PageHeader`, with its
 * actions. Organisation-wide pages show no scope control at all.
 *
 * `sessionReady` gates every data-reading child. On the first anonymous visit
 * the shell provisions the session cookie before anything else runs. A query
 * that fires ahead of it gets a 401, and the API client treats that as "sign
 * in again" and hard-navigates away, so an ungated control in the bar would
 * bounce the user off the page they asked for.
 */
function Toolbar({
  sessionReady,
  organisationName = null,
  onOpenPalette,
  className,
}: {
  sessionReady: boolean
  /** The business's name, which a business's scope control reads. */
  organisationName?: string | null
  onOpenPalette: () => void
  className?: string
}) {
  const mode = useWorkspaceMode()

  return (
    <header
      data-slot="toolbar"
      className={cn(
        "hidden h-(--np-toolbar-h) shrink-0 items-center gap-3 bg-canvas px-(--np-page-pad-x) shadow-np-edge-bottom md:flex",
        className
      )}
    >
      {sessionReady ? (
        // The control reads the address; the boundary keeps a prerendered
        // page from bailing the whole toolbar out to client rendering.
        <Suspense fallback={null}>
          <ScopeControlView
            variant="pill"
            mode={mode}
            organisationName={organisationName}
            className="wide:hidden"
          />
        </Suspense>
      ) : null}
      {sessionReady ? (
        <Suspense fallback={<div className="flex-1" />}>
          <ToolbarWayfinding />
        </Suspense>
      ) : (
        <div className="flex-1" />
      )}

      {sessionReady ? <CommandPaletteButton onClick={onOpenPalette} /> : null}
      {sessionReady ? <NotificationsLink /> : null}
    </header>
  )
}

export { Toolbar }
