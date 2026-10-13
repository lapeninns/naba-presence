"use client"

import * as React from "react"
import { Suspense } from "react"

import { useWorkspaceMode } from "@/lib/workspace/mode"
import { cn } from "@/lib/utils"

import { ShellBackLink } from "./app-bar"
import { ShellBreadcrumbs, useShellBack } from "./breadcrumbs-context"
import { ClientSwitcher } from "./client-switcher"
import { CommandPaletteButton } from "./command-palette"
import { ContextHealthChip } from "./context-health-chip"
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
    <div className="flex min-w-0 flex-1 items-center">
      <ShellBreadcrumbs className="hidden min-w-0 flex-1 wide:flex" />
      {back ? (
        <ShellBackLink target={back} className="-ml-1 wide:hidden" />
      ) : null}
    </div>
  )
}

/**
 * The desk toolbar: the 56px strip above the content column that the page
 * scrolls beneath, from 768px. Which client you are working (the switcher),
 * where you are (the trail, or the back control on a tablet), whether
 * anything is broken (the health chip, in words) and how to get anywhere
 * (search). The page's own title is NOT here: it lives in `PageHeader`,
 * with its actions. Phones get the app bar instead (app-bar.tsx); the two
 * are switched by CSS, never by a JS media query.
 *
 * `sessionReady` gates every data-reading child. On the first anonymous visit
 * the shell provisions the session cookie before anything else runs. A query
 * that fires ahead of it gets a 401, and the API client treats that as "sign
 * in again" and hard-navigates away, so an ungated chip in the toolbar would
 * bounce the user off the page they asked for.
 */
function Toolbar({
  sessionReady,
  onOpenPalette,
  className,
}: {
  sessionReady: boolean
  onOpenPalette: () => void
  className?: string
}) {
  // A business has one home client behind the scenes; the switcher is
  // agency furniture.
  const agency = useWorkspaceMode() === "agency"

  return (
    <header
      data-slot="toolbar"
      className={cn(
        "hidden h-(--np-toolbar-h) shrink-0 items-center gap-3 bg-canvas px-(--np-page-pad-x) shadow-[inset_0_-1px_0_var(--np-line)] md:flex",
        className
      )}
    >
      {sessionReady && agency ? (
        // The switcher reads the address; the boundary keeps a prerendered
        // page from bailing the whole toolbar out to client rendering.
        <Suspense fallback={null}>
          <ClientSwitcher />
        </Suspense>
      ) : null}
      {sessionReady ? (
        <Suspense fallback={<div className="flex-1" />}>
          <ToolbarWayfinding />
        </Suspense>
      ) : (
        <div className="flex-1" />
      )}

      {sessionReady ? <ContextHealthChip /> : null}
      {sessionReady ? <NotificationsLink /> : null}
      {sessionReady ? <CommandPaletteButton onClick={onOpenPalette} /> : null}
    </header>
  )
}

export { Toolbar }
