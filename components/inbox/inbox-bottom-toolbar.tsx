import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * The phone drawing of the Inbox's list controls (R10, INB-19): the search
 * field and the Filters button, with Sync beside them, in a bar fixed to the
 * bottom of the screen where a thumb rests, above the tab bar.
 *
 * Layout is CSS, so the server's HTML is right at both widths and nothing
 * moves on hydration. From `md` the wrapper is a plain block and the toolbar
 * sits in the band under the title as it always has. Below `md`:
 *
 * - It floats where the `float-bar` variant holds: a phone at least 40rem
 *   tall, or any phone with the keyboard up. A short phone (320x568, or a
 *   phone held sideways) keeps it in the band, Sync beside the field, so
 *   fixed chrome stays within a quarter of the screen.
 * - Where the floating bar sits is the CHROME CONTRACT's (`[data-slot=
 *   "inbox-bottom-toolbar"]` in app/globals.css): on top of the tab bar, on
 *   the keyboard while it is open (search takes the keyboard), and out of the
 *   way while a docked bar (the selection bar, a review's publish bar) owns
 *   the edge: one bottom bar at a time.
 * - `InboxBottomToolbarSpacer` keeps the list's last row reachable above it.
 * - Sync moves in beside the field (`trailing`) and leaves the page header;
 *   search mode takes the whole width for the field and its Cancel.
 */
const BAR_HEIGHT_CLASS = "float-bar:h-(--np-actionbar-h)"

function InboxBottomToolbar({
  searchMode,
  trailing,
  children,
  className,
}: {
  /** Search mode (the field and its Cancel take the whole bar). */
  searchMode: boolean
  /** The phone's sync control. Drawn beside the toolbar, hidden in search. */
  trailing?: ReactNode
  /** The `Toolbar`. */
  children: ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="inbox-bottom-toolbar"
      className={cn(
        "min-w-0",
        "max-md:flex max-md:items-center max-md:gap-2",
        "float-bar:z-chrome float-bar:border-t float-bar:border-line float-bar:bg-surface",
        // The page gutter, or the landscape notch when that is wider.
        "float-bar:pr-[max(--spacing(4),var(--np-safe-right))] float-bar:pl-[max(--spacing(4),var(--np-safe-left))]",
        BAR_HEIGHT_CLASS,
        className
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {trailing != null ? (
        // Hidden, not removed, in search: a sync that is running keeps its
        // pending state, so Cancel never brings back a second Sync to fire.
        <div
          data-slot="inbox-bottom-toolbar-trailing"
          hidden={searchMode}
          className="flex shrink-0 empty:hidden md:hidden"
        >
          {trailing}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The room the floating bar takes at the foot of the list, so the last row
 * can scroll clear of it. Only where the bar floats (`float-bar`); the bar
 * steps aside for a docked bar, which brings its own spacer, and so does
 * this (globals.css).
 */
function InboxBottomToolbarSpacer() {
  return (
    <div
      aria-hidden
      data-slot="inbox-bottom-toolbar-spacer"
      className="hidden h-(--np-actionbar-h) shrink-0 float-bar:block"
    />
  )
}

export { InboxBottomToolbar, InboxBottomToolbarSpacer }
