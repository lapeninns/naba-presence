"use client"

import { Menu } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"

import { ShellBreadcrumbs } from "./breadcrumbs-context"
import {
  CommandPalette,
  CommandPaletteButton,
  useCommandPalette,
} from "./command-palette"
import { ContextHealthChip } from "./context-health-chip"
import { ThemeToggle } from "./theme-toggle"

/**
 * The bar above the page: where you are, how to get anywhere, and whether
 * anything is broken.
 *
 * The old topbar held only a status dot and a theme toggle, so the nested
 * agency IA had no wayfinding at all — a user three levels into a location's
 * hours tab could not see which client they were in.
 */
/**
 * `sessionReady` gates every data-reading child.
 *
 * On the first anonymous visit the shell provisions the session cookie before
 * anything else runs. A query that fires ahead of it gets a 401, and the API
 * client treats that as "sign in again" and hard-navigates away — so an
 * ungated chip in the topbar would bounce the user off the page they asked
 * for.
 */
function Topbar({
  onOpenNav,
  sessionReady,
}: {
  onOpenNav: () => void
  sessionReady: boolean
}) {
  const palette = useCommandPalette()

  return (
    <header className="flex h-13 shrink-0 items-center gap-3 border-b border-line-subtle px-4 md:px-(--np-page-pad-x)">
      <Button
        variant="outline"
        size="icon-sm"
        className="md:hidden"
        aria-label="Open navigation"
        onClick={onOpenNav}
      >
        <Menu aria-hidden />
      </Button>

      {sessionReady ? (
        <ShellBreadcrumbs className="hidden min-w-0 flex-1 sm:block" />
      ) : (
        <div className="hidden flex-1 sm:block" />
      )}

      <div className="ml-auto flex items-center gap-2">
        {sessionReady ? (
          <CommandPaletteButton onClick={() => palette.setOpen(true)} />
        ) : null}
        {sessionReady ? <ContextHealthChip /> : null}
        <ThemeToggle />
      </div>

      {sessionReady ? (
        <CommandPalette open={palette.open} onOpenChange={palette.setOpen} />
      ) : null}
    </header>
  )
}

export { Topbar }
