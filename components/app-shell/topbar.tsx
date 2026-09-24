"use client"

import { Menu } from "lucide-react"
import * as React from "react"
import { Suspense } from "react"

import { cn } from "@/lib/utils"

import { ShellBreadcrumbs } from "./breadcrumbs-context"
import { ClientScopeSync, ClientSwitcher } from "./client-switcher"
import {
  CommandPalette,
  CommandPaletteButton,
  useCommandPalette,
} from "./command-palette"
import { ContextHealthChip } from "./context-health-chip"

/**
 * The toolbar: the 56px strip above the content column that the page scrolls
 * beneath. Which client you are working (the switcher), where you are (the
 * trail), whether anything is broken (the health chip) and how to get
 * anywhere (search). The page's own title is NOT here: it lives in
 * `PageHeader`, in the content column, with its actions.
 *
 * Below 768px the trail collapses to its last crumb, the chip and search
 * become 44px icon buttons, and the menu button that opens the navigation
 * sheet appears at the trailing edge. Below 640px the switcher shows the
 * client's mark alone.
 *
 * `sessionReady` gates every data-reading child. On the first anonymous visit
 * the shell provisions the session cookie before anything else runs. A query
 * that fires ahead of it gets a 401, and the API client treats that as "sign
 * in again" and hard-navigates away, so an ungated chip in the toolbar would
 * bounce the user off the page they asked for.
 */
function Toolbar({
  onOpenNav,
  navOpen = false,
  navToggleRef,
  sessionReady,
  className,
}: {
  onOpenNav: () => void
  navOpen?: boolean
  navToggleRef?: React.Ref<HTMLButtonElement>
  sessionReady: boolean
  className?: string
}) {
  const palette = useCommandPalette()

  return (
    <header
      data-slot="toolbar"
      className={cn(
        "flex h-(--np-toolbar-h) shrink-0 items-center gap-3 bg-canvas px-5 shadow-[inset_0_-1px_0_var(--np-line)] max-md:gap-2 md:px-(--np-page-pad-x)",
        className
      )}
    >
      {sessionReady ? (
        // Both read the address; the boundary keeps a prerendered page from
        // bailing the whole toolbar out to client rendering.
        <Suspense fallback={null}>
          <ClientScopeSync />
          <ClientSwitcher />
        </Suspense>
      ) : null}
      {sessionReady ? (
        <ShellBreadcrumbs className="min-w-0 flex-1" />
      ) : (
        <div className="flex-1" />
      )}

      {sessionReady ? <ContextHealthChip /> : null}
      {sessionReady ? (
        <CommandPaletteButton onClick={() => palette.setOpen(true)} />
      ) : null}
      <button
        ref={navToggleRef}
        type="button"
        aria-label="Open navigation"
        aria-expanded={navOpen}
        aria-controls="mobile-navigation"
        onClick={onOpenNav}
        className="grid size-11 shrink-0 place-items-center rounded-md text-ink focus-halo transition-colors duration-(--np-duration-fast) hover:bg-fill focus-visible:outline-none md:hidden"
      >
        <Menu className="size-5" strokeWidth={1.75} aria-hidden />
      </button>

      {sessionReady ? (
        <CommandPalette open={palette.open} onOpenChange={palette.setOpen} />
      ) : null}
    </header>
  )
}

/** The toolbar under the name the shell has always imported it by. */
const Topbar = Toolbar

export { Toolbar, Topbar }
