"use client"

import { Menu } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { ShellBreadcrumbs } from "./breadcrumbs-context"
import {
  CommandPalette,
  CommandPaletteButton,
  useCommandPalette,
} from "./command-palette"
import { ContextHealthChip } from "./context-health-chip"
import { ThemeToggle } from "./theme-toggle"

/**
 * The toolbar: the strip above the content column that the page scrolls
 * beneath. Where you are (the trail), how to get anywhere (search), and
 * whether anything is broken (the health capsule). The page's own title is
 * NOT here — it lives in `PageHeader`, in the content column, with its
 * actions — which is what makes this a toolbar and not a title bar.
 *
 * It is a material: translucent and blurred, with a hairline along its bottom
 * edge drawn as an inset shadow so it never takes a pixel of layout. The
 * shell makes it sticky inside the scroll column; this component only draws.
 *
 * `sessionReady` gates every data-reading child. On the first anonymous visit
 * the shell provisions the session cookie before anything else runs. A query
 * that fires ahead of it gets a 401, and the API client treats that as "sign
 * in again" and hard-navigates away — so an ungated chip in the toolbar
 * would bounce the user off the page they asked for.
 */
function Toolbar({
  onOpenNav,
  sessionReady,
  className,
}: {
  onOpenNav: () => void
  sessionReady: boolean
  className?: string
}) {
  const palette = useCommandPalette()

  return (
    <header
      data-slot="toolbar"
      className={cn(
        "flex h-(--np-toolbar-h) shrink-0 items-center gap-3 material-toolbar px-4 [box-shadow:inset_0_-0.5px_0_var(--np-line)] md:px-(--np-page-pad-x)",
        className
      )}
    >
      {/* The one control in the toolbar that exists only below `md`, which
          is to say only where a finger is likely to be the pointer. It takes
          the 44px comfortable target there rather than the 32px control
          height the rest of the toolbar is built on — the same rule the
          location tab strip applies to its capsules. */}
      <Button
        variant="secondary"
        size="icon"
        className="md:hidden pointer-coarse:size-11"
        aria-label="Open navigation"
        onClick={onOpenNav}
      >
        <Menu strokeWidth={1.75} aria-hidden />
      </Button>

      {sessionReady ? (
        <ShellBreadcrumbs className="hidden min-w-0 flex-1 sm:block" />
      ) : (
        <div className="hidden flex-1 sm:block" />
      )}

      <div className="ml-auto flex items-center gap-2">
        {sessionReady ? <ContextHealthChip /> : null}
        {sessionReady ? (
          <CommandPaletteButton onClick={() => palette.setOpen(true)} />
        ) : null}
        <ThemeToggle />
      </div>

      {sessionReady ? (
        <CommandPalette open={palette.open} onOpenChange={palette.setOpen} />
      ) : null}
    </header>
  )
}

/** The toolbar under the name the shell has always imported it by. */
const Topbar = Toolbar

export { Toolbar, Topbar }
