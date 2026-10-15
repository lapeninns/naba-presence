"use client"

import * as React from "react"
import { XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  OverlayGrabber,
  overlayScrimClassName,
  overlayTitleClassName,
  usePhoneOverlay,
} from "@/components/ui/overlay"
import { cn } from "@/lib/utils"

/**
 * The one menu recipe under Select, DropdownMenu, Combobox and (for its
 * touch drawing) Popover.
 *
 * On the desk a menu is the reference `.menu`: a small floating panel by
 * its trigger with 32px rows. On a phone a floating panel is a 44px-row
 * target pinned somewhere the thumb has to travel to, so the same parts
 * present as a bottom action sheet instead: scrim, a full-width list
 * anchored to the bottom edge under the same header as every other overlay
 * (grabber, a left-aligned title, a ✕). The parts and their semantics (menu,
 * listbox) are the same; only the geometry changes, decided when the menu
 * opens (see `usePhoneOverlay`).
 */

/* ---- Desk: the floating panel ------------------------------------------ */

/**
 * The floating popup (Notion Mail's popover menu): an opaque surface (no
 * glass, D3), hairline edge, the menu radius, the soft float shadow, 6px
 * inset. Base UI's Select aligns the popup with the
 * trigger item by default (`data-side="none"`), in which case nothing
 * scales: the menu simply appears over the trigger.
 */
export const menuPopupClassName = cn(
  "rounded-menu border border-line bg-surface p-1.5 text-ink shadow-np-float outline-none",
  "origin-(--transform-origin) transition-[transform,opacity] duration-(--np-duration-overlay) ease-spring",
  "data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0",
  "data-[side=none]:data-starting-style:scale-100 data-[side=none]:data-starting-style:opacity-100 data-[side=none]:data-starting-style:transition-none"
)

/**
 * A row: the menu-row height token (44px on touch, 32px on the desk), the
 * tag radius, the hover fill when highlighted, muted ink when disabled so a
 * reason under it can still be read.
 */
export const menuRowClassName = cn(
  "group/item relative flex min-h-(--np-menu-item-h) cursor-default items-center gap-2.5 rounded-(--np-radius-tag) px-2.5 py-1 text-ui text-ink outline-none select-none",
  "data-highlighted:bg-fill data-disabled:text-ink-muted",
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
)

/** A choice row (Select, Combobox): a checkmark column on the left. */
export const menuItemClassName = cn(
  menuRowClassName,
  "gap-2 pl-8 data-selected:font-semibold data-disabled:pointer-events-none"
)

/** A group heading, in the caption role (never under 12px). */
export const menuGroupLabelClassName =
  "px-2.5 pt-1.5 pb-0.5 text-caption font-medium text-ink-muted"

export const menuSeparatorClassName = "mx-0.5 my-1 h-px shrink-0 bg-line"

/* ---- Touch: the action sheet -------------------------------------------- */

/** Whether a menu opening now presents as an action sheet. */
export const useMenuSheet = usePhoneOverlay

/** The menu's scrim, above any dialog the menu was opened from. */
export const menuSheetScrimClassName = cn(overlayScrimClassName, "z-popover")

/**
 * Pins Base UI's positioner to the bottom edge. Its own placement arrives
 * as inline `top`/`left`/`transform`, so these win with `!important`.
 */
export const menuSheetPositionerClassName =
  "fixed! inset-x-0! top-auto! bottom-0! z-popover transform-none! outline-none"

/**
 * The sheet: full width up to 40rem, 20px top corners, at most three
 * quarters of the screen, rising on the sheet duration. Its bottom padding
 * clears the home indicator and, if a field inside has raised it, the
 * keyboard. The width, padding and height rules are `!important` so a
 * caller's desk sizing (`w-72`, `p-0`) cannot squeeze the sheet.
 */
export const menuSheetPopupClassName = cn(
  "relative mx-auto flex max-h-[min(75dvh,calc(100dvh-var(--np-safe-top)-3rem))]! w-full! max-w-[min(100%,var(--np-sheet-max-w))]! min-w-0! flex-col overflow-hidden rounded-t-(--np-radius-sheet) rounded-b-none border-0 bg-surface p-0! pb-[calc(--spacing(2)+var(--np-dock-bottom))]! text-ink shadow-(--np-shadow-modal) outline-none",
  "transition-transform duration-(--np-duration-sheet) ease-out-strong data-ending-style:translate-y-full data-ending-style:duration-(--np-duration-standard) data-starting-style:translate-y-full"
)

/**
 * The scrolling list inside the sheet. Rows take the body size here: a
 * thumb-sized row with 15px text reads as a desk menu blown up.
 */
export const menuSheetListClassName =
  "min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-1.5 outline-none [&_[role=option]]:text-body [&_[role^=menuitem]]:text-body"

/**
 * The root's close action, so the ✕ can close any of the menu kinds.
 * Each root wrapper owns the Base UI `actionsRef` and still forwards it to
 * a caller that passed one.
 */
const MenuCloseContext = React.createContext<(() => void) | null>(null)

type CloseActions = { close: () => void }

export function useMenuActions<A extends CloseActions>(
  actionsRef: React.Ref<A | null> | undefined
) {
  const actions = React.useRef<A | null>(null)
  React.useImperativeHandle(
    actionsRef,
    () =>
      // Delegate every action to whatever Base UI installed, read late, so
      // the caller's ref never holds a stale object.
      new Proxy({} as A, {
        get:
          (_target, key) =>
          (...args: unknown[]) => {
            const action = (actions.current as Record<PropertyKey, unknown>)?.[
              key
            ]
            return typeof action === "function"
              ? (action as (...a: unknown[]) => unknown)(...args)
              : undefined
          },
      }),
    []
  )
  const close = React.useCallback(() => actions.current?.close(), [])
  return { actions, close }
}

export function MenuCloseProvider({
  close,
  children,
}: {
  close: () => void
  children: React.ReactNode
}) {
  return (
    <MenuCloseContext.Provider value={close}>
      {children}
    </MenuCloseContext.Provider>
  )
}

/**
 * The sheet's header, the overlay recipe in a menu's drawing: the grabber
 * and the title left-aligned (when the menu has one: "Sort by"). The ✕ is
 * `MenuSheetClose`, drawn after the list so that the popup's initial focus
 * lands on the selected option or first item, never on the ✕; it is still a
 * Tab stop, and sits in the top corner. There is no Cancel under the list:
 * the ✕ is the visible way out, as in a dialog, and tapping the scrim does
 * the same. The title is text, not a heading, so the menu's own role stays
 * the only landmark in it. Base UI's menu popups carry no drag gesture, so
 * the grabber is the sheet's mark and not a handle: it keeps the default
 * cursor.
 */
export function MenuSheetHeader({
  title,
  className,
}: {
  title?: React.ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="menu-sheet-header"
      className={cn("flex shrink-0 flex-col", className)}
    >
      <OverlayGrabber className="cursor-default touch-auto active:cursor-default" />
      <div className="flex min-h-(--np-touch) items-center pr-14 pl-5">
        {title ? (
          <div
            data-slot="menu-sheet-title"
            className={cn(overlayTitleClassName, "min-w-0 flex-1")}
          >
            {title}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * The sheet's ✕, last in the popup's DOM and pinned to its top-right corner
 * (see `MenuSheetHeader`).
 */
export function MenuSheetClose() {
  const close = React.useContext(MenuCloseContext)
  if (!close) return null
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      data-slot="menu-sheet-close"
      aria-label="Close"
      className="absolute top-5 right-2 text-ink-muted hover:text-ink [&_svg]:size-4"
      onClick={() => close()}
    >
      <XIcon aria-hidden="true" />
    </Button>
  )
}
