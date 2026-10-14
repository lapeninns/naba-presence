"use client"

import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar"
import Link from "next/link"
import * as React from "react"

import { DockSpacer } from "@/components/ui/action-bar"
import { cn } from "@/lib/utils"

/**
 * The bar of a multi-select (NM 03/02, brief §4.3 `SelectionBar`, D4): while
 * anything is ticked it owns the bottom edge instead of the tab bar.
 *
 *   header   "N selected" (announced politely as it changes) and a 44px
 *            "Cancel" that ends select mode.
 *   tiles    `SelectionBarTile`s in a toolbar (one Tab stop, arrow keys move
 *            between tiles): icon over a `text-caption` label, 64px, on a
 *            phone; an inline icon-and-label button from `md`.
 *   notes    optional words above the header ("2 of these are not ready for
 *            your approval"), for what the operator must know before acting.
 *
 * Tile tones: `default`; `danger` for a destructive local action; `accent`
 * for the one local next step (a navigation, never a Google write);
 * `charcoal` for the one action that writes to Google (approve and
 * publish). That tile opens the charcoal reviewed-write step, never
 * publishes directly. `SelectionBarLinkTile` is a tile that navigates
 * ("Prepare bulk change" → `/listings/bulk?ids=…`), `accent` by default.
 *
 * Docking. On a phone (below `md`) the bar is fixed to the bottom edge and
 * renders `data-docked="bottom"`, the same CHROME CONTRACT attribute the
 * docked ActionBar uses (globals.css): the tab bar steps aside, scroll
 * padding grows, and the toast stack sits above the bar. `pb-dock` keeps the
 * tiles over the home indicator and the keyboard. An in-flow spacer the
 * bar's measured height keeps the list's last row reachable, and the height
 * is published as `--np-dock-bar-h`, which the scroll padding and the toast
 * viewport read. From `md` the bar is an inline, sticky row at the foot of
 * the list. `dock={false}` keeps it inline at every width (a bar inside a
 * card or a dialog). The spacer is `data-slot="selection-bar-spacer"`;
 * `spacerSlot="action-bar-spacer"` gives it the shared ActionBar spacer's
 * slot, for a screen that swaps a docked ActionBar for this bar and pins
 * that slot.
 *
 * Adopting it from a bulk bar: pass the count and `onCancel` (clear and leave
 * select mode), one `SelectionBarTile` per action, and a tile as the render
 * of a menu trigger for an overflow:
 *
 *   <DropdownMenuTrigger render={<SelectionBarTile icon={<Ellipsis />} label="More" />} />
 */
function SelectionBar({
  count,
  countLabel,
  onCancel,
  cancelLabel = "Cancel",
  label = "Selection actions",
  notes,
  dock = true,
  visible = true,
  spacerSlot = "selection-bar-spacer",
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  /** How many items are selected. */
  count: number
  /** Replaces "{count} selected" ("3 reviews selected"). */
  countLabel?: React.ReactNode
  /** Ends select mode (clear the selection). */
  onCancel: () => void
  cancelLabel?: string
  /** Names the toolbar of tiles (default "Selection actions"). */
  label?: string
  /** Words the operator must read before acting, above the header. */
  notes?: React.ReactNode
  /** Phone: fix to the bottom edge, replacing the tab bar (default true). */
  dock?: boolean
  /** Default true. Pass "has a selection" to show the bar only then. */
  visible?: boolean
  /**
   * The docked spacer's `data-slot`. Default `"selection-bar-spacer"`;
   * `"action-bar-spacer"` matches the shared ActionBar spacer; any other
   * name is the caller's (a screen whose tests pin its own spacer slot).
   */
  spacerSlot?: "selection-bar-spacer" | "action-bar-spacer" | (string & {})
  /** The `SelectionBarTile`s. */
  children?: React.ReactNode
}) {
  if (!visible) return null
  const bar = (
    <div
      role="region"
      aria-label={label}
      data-slot="selection-bar"
      data-docked={dock ? "bottom" : undefined}
      className={cn(
        "z-chrome flex flex-col gap-2 border-line bg-surface text-ink",
        // From md (and whenever it is not docked): an inline card, one row.
        "rounded-(--np-radius-card) border px-3 py-2 shadow-np-float md:flex-row md:flex-wrap md:items-center md:gap-3",
        dock && "md:sticky md:bottom-3",
        dock && DOCKED_CLASS,
        className
      )}
      {...props}
    >
      {notes ? (
        <div
          data-slot="selection-bar-notes"
          className="text-caption text-ink-muted md:order-first md:basis-full"
        >
          {notes}
        </div>
      ) : null}
      <div
        data-slot="selection-bar-header"
        className="flex min-h-(--np-touch) items-center gap-3 md:contents"
      >
        <p
          data-slot="selection-bar-count"
          aria-live="polite"
          aria-atomic="true"
          className="min-w-0 flex-1 truncate text-title font-semibold tabular-nums md:order-1 md:flex-none md:text-ui"
        >
          {countLabel ?? `${count} selected`}
        </p>
        <button
          type="button"
          data-slot="selection-bar-cancel"
          onClick={onCancel}
          className="-mr-2 inline-flex min-h-(--np-touch) min-w-(--np-touch) shrink-0 items-center justify-center rounded-(--np-radius-control) px-2 text-body text-ink-secondary focus-halo md:order-3 md:mr-0 md:text-ui md:font-medium hover-fine:hover:bg-fill hover-fine:hover:text-ink desk:min-h-(--np-control-h)"
        >
          {cancelLabel}
        </button>
      </div>
      <ToolbarPrimitive.Root
        aria-label="Actions"
        data-slot="selection-bar-actions"
        className="-my-1 flex gap-2 overflow-x-auto py-1 md:order-2 md:ml-auto md:overflow-visible"
      >
        {children}
      </ToolbarPrimitive.Root>
    </div>
  )
  if (!dock) return bar
  return (
    <>
      {/* The shared spacer (action-bar): keeps the list's last row
          reachable above the fixed bar and publishes its height for the
          scroll padding and the toast stack, without clearing another
          docked bar's. The fallback is a header row over the tiles. */}
      <DockSpacer
        data-slot={spacerSlot}
        className="h-[var(--np-dock-bar-h,calc(var(--np-actionbar-h)+var(--np-touch)+var(--np-dock-bottom)))] md:hidden"
      />
      {bar}
    </>
  )
}

/**
 * The phone drawing: full width on the bottom edge, square corners, a
 * hairline on top, the page gutter (or the landscape notch) at the sides,
 * the dock edge below. It slides up on mount; reduced motion makes that
 * instant (globals.css).
 */
const DOCKED_CLASS = cn(
  "max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:m-0 max-md:rounded-none max-md:border-x-0 max-md:border-t max-md:border-b-0 max-md:shadow-none",
  "max-md:pr-[max(var(--np-page-pad-x),var(--np-safe-right))] max-md:pl-[max(var(--np-page-pad-x),var(--np-safe-left))]",
  "max-md:pt-1 max-md:pb-[max(--spacing(2),var(--np-dock-bottom))]",
  "max-md:transition-transform max-md:duration-(--np-duration-sheet) max-md:ease-out max-md:starting:translate-y-full"
)

export type SelectionBarTileTone = "default" | "danger" | "accent" | "charcoal"

const TILE_TONE: Record<SelectionBarTileTone, string> = {
  default: "bg-surface-alt text-ink hover-fine:hover:bg-fill",
  danger: "bg-surface-alt text-danger-ink hover-fine:hover:bg-danger-tint",
  // accent-ink on accent-tint: the active chip's gated pair.
  accent: "bg-accent-tint text-accent-ink font-semibold",
  // The on-charcoal ink and fill; the focus halo is the shared one.
  charcoal: "on-charcoal",
}

const TILE_CLASS = cn(
  "relative inline-flex min-h-16 min-w-16 flex-1 shrink-0 flex-col items-center justify-center gap-1 rounded-(--np-radius-card) px-2 py-2 text-caption font-medium whitespace-nowrap no-underline focus-halo select-none",
  "transition-colors duration-(--np-duration-fast) ease-standard",
  "data-disabled:cursor-not-allowed data-disabled:opacity-50",
  "[&_svg]:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0 [&_svg]:[stroke-width:1.5]",
  "md:min-h-(--np-control-h) md:min-w-0 md:flex-none md:flex-row md:gap-1.5 md:rounded-(--np-radius-control) md:px-3 md:py-0 md:text-ui md:font-semibold md:[&_svg]:size-4"
)

/**
 * One action in a SelectionBar. Its visible label is its accessible name.
 * Phone: a 64px tile, icon over a `text-caption` label. From `md`: an
 * inline button, icon beside the label, the control height. Usable as the
 * `render` of a menu trigger, so an overflow is a tile too.
 */
function SelectionBarTile({
  icon,
  label,
  tone = "default",
  className,
  children,
  ...props
}: Omit<ToolbarPrimitive.Button.Props, "children"> & {
  /** A lucide glyph, drawn at 20px. */
  icon?: React.ReactNode
  /** The visible words, which are also the accessible name. */
  label: React.ReactNode
  tone?: SelectionBarTileTone
  /** Extra content after the label (a count badge). */
  children?: React.ReactNode
}) {
  return (
    <ToolbarPrimitive.Button
      data-slot="selection-bar-tile"
      data-tone={tone}
      className={cn(TILE_CLASS, TILE_TONE[tone], className)}
      {...props}
    >
      {icon}
      <span data-slot="selection-bar-tile-label">{label}</span>
      {children}
    </ToolbarPrimitive.Button>
  )
}

/**
 * A tile that navigates (a Next link inside the toolbar's arrow-key group):
 * a LOCAL next step such as "Prepare bulk change", never a Google write.
 * `accent` by default; the visible label is the link's name.
 */
function SelectionBarLinkTile({
  href,
  icon,
  label,
  tone = "accent",
  className,
  children,
  ...props
}: Omit<ToolbarPrimitive.Link.Props, "children" | "href" | "render"> & {
  href: string
  /** A lucide glyph, drawn at 20px. */
  icon?: React.ReactNode
  /** The visible words, which are also the accessible name. */
  label: React.ReactNode
  /** `charcoal` is for Google writes, which are never a plain link. */
  tone?: Exclude<SelectionBarTileTone, "charcoal">
  /** Extra content after the label (a count badge). */
  children?: React.ReactNode
}) {
  return (
    <ToolbarPrimitive.Link
      render={<Link href={href} />}
      data-slot="selection-bar-tile"
      data-tone={tone}
      className={cn(TILE_CLASS, TILE_TONE[tone], className)}
      {...props}
    >
      {icon}
      <span data-slot="selection-bar-tile-label">{label}</span>
      {children}
    </ToolbarPrimitive.Link>
  )
}

export { SelectionBar, SelectionBarLinkTile, SelectionBarTile }
