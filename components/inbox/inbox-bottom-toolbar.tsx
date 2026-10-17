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
 * - Where the bar sits is the CHROME CONTRACT's (`[data-slot="inbox-bottom-
 *   toolbar"]` in app/globals.css): on top of the tab bar, on the keyboard
 *   while it is open (search takes the keyboard), and out of the way while a
 *   docked bar (the selection bar, a review's publish bar) owns the edge:
 *   one bottom bar at a time.
 * - `InboxBottomToolbarSpacer` keeps the list's last row reachable above it.
 * - Sync moves in beside the field (`trailing`) and leaves the page header;
 *   search mode takes the whole width for the field and its Cancel.
 */
const BAR_HEIGHT_CLASS = "max-md:h-(--np-actionbar-h)"

function InboxBottomToolbar({
  searchMode,
  trailing,
  children,
  className,
}: {
  /** Search mode (the field and its Cancel take the whole bar). */
  searchMode: boolean
  /** The phone's sync control. Drawn beside the toolbar, never in search. */
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
        "max-md:z-chrome max-md:flex max-md:items-center max-md:gap-2 max-md:border-t max-md:border-line max-md:bg-surface",
        // The page gutter, or the landscape notch when that is wider.
        "max-md:pr-[max(--spacing(4),var(--np-safe-right))] max-md:pl-[max(--spacing(4),var(--np-safe-left))]",
        BAR_HEIGHT_CLASS,
        className
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {trailing != null && !searchMode ? (
        <div
          data-slot="inbox-bottom-toolbar-trailing"
          className="flex shrink-0 empty:hidden md:hidden"
        >
          {trailing}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The room the fixed bar takes at the foot of the list, so the last row can
 * scroll clear of it. Phone only; the bar steps aside for a docked bar, which
 * brings its own spacer, and so does this (globals.css).
 */
function InboxBottomToolbarSpacer() {
  return (
    <div
      aria-hidden
      data-slot="inbox-bottom-toolbar-spacer"
      className="h-(--np-actionbar-h) shrink-0 md:hidden"
    />
  )
}

export { InboxBottomToolbar, InboxBottomToolbarSpacer }
