"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import {
  DialogPrimitive,
  DrawerPrimitive,
  OverlayChrome,
  OverlayRoot,
  overlayFooterClassName,
  overlayFooterDockClassName,
  overlayPopupClassName,
  overlayScrimClassName,
  overlayScrollPaddingClassName,
  overlayViewportClassName,
  useOverlayChrome,
  useOverlayHeader,
  usePhoneOverlay,
  useOverlayRoot,
  useReportSwipeDirection,
  type OverlayRootProps,
} from "@/components/ui/overlay"

/**
 * A sheet: an overlay that comes in from an edge and can be swiped back to
 * it. Built on Base UI's Drawer, so the handle is real: the sheet follows
 * the finger, a fast or long enough drag dismisses it, and `snapPoints`
 * (on the root) can rest it part-way up. `dirty` asks before an accidental
 * dismissal (scrim, Escape, swipe, ✕) throws edits away.
 *
 *   <Sheet open={open} onOpenChange={setOpen} dirty={edited}>
 *     <SheetContent side="right">
 *       <SheetHeader><SheetTitle>Filters</SheetTitle></SheetHeader>
 *       <SheetBody>…</SheetBody>
 *       <SheetFooter><Button onClick={apply}>Show results</Button></SheetFooter>
 *     </SheetContent>
 *   </Sheet>
 */
function Sheet(props: OverlayRootProps) {
  return <OverlayRoot data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />
}

type SheetSide = "top" | "right" | "bottom" | "left"
type SheetPresentation = "sheet" | "panel" | "drawer" | "top"

/**
 * Reference `dialog.sheet`, by side:
 *
 *   right   (the default) a bottom sheet on a phone, a full-height panel
 *           from the right edge from `sm`, min(560px, 100vw) wide
 *           (`size="wide"`: 880px)
 *   left    the navigation drawer at every width, min(300px, 86vw)
 *   bottom  a bottom sheet at every width (centred, at most 40rem wide)
 *   top     drops from the top edge
 */
function presentationFor(side: SheetSide, phone: boolean): SheetPresentation {
  if (side === "left") return "drawer"
  if (side === "top") return "top"
  if (side === "bottom") return "sheet"
  return phone ? "sheet" : "panel"
}

const swipeDirectionFor = {
  sheet: "down",
  panel: "right",
  drawer: "left",
  top: "up",
} as const

/** How each presentation sits in the full-viewport layer. */
const viewportAlignClassName: Record<SheetPresentation, string> = {
  sheet: "items-end",
  panel: "justify-end",
  drawer: "justify-start",
  top: "items-start",
}

function SheetContent({
  className,
  children,
  side = "right",
  size = "default",
  showCloseButton = true,
  overlayClassName,
  ...props
}: DrawerPrimitive.Popup.Props & {
  side?: SheetSide
  size?: "default" | "wide"
  showCloseButton?: boolean
  /** Extra classes for the scrim (e.g. `md:hidden` for a phone-only drawer). */
  overlayClassName?: string
}) {
  const root = useOverlayRoot()
  // Held while open, like Dialog: a tablet rotated under an open sheet
  // keeps its drawing until it closes.
  const phone = usePhoneOverlay()
  const live = presentationFor(side, phone)
  const [held, setHeld] = React.useState(live)
  if (!root?.open && held !== live) setHeld(live)
  const presentation = root?.open ? held : live
  useReportSwipeDirection(swipeDirectionFor[presentation])

  return (
    <DrawerPrimitive.VirtualKeyboardProvider>
      <DrawerPrimitive.Portal data-slot="sheet-portal">
        <DrawerPrimitive.Backdrop
          data-slot="sheet-overlay"
          className={cn(overlayScrimClassName, overlayClassName)}
        />
        <DrawerPrimitive.Viewport
          className={cn(
            overlayViewportClassName,
            viewportAlignClassName[presentation]
          )}
        >
          <DrawerPrimitive.Popup
            data-slot="sheet-content"
            data-side={side}
            data-size={size}
            data-presentation={presentation}
            className={cn(
              overlayPopupClassName[presentation],
              overlayScrollPaddingClassName,
              className,
              // A phone's sheet spans the screen whatever the panel width.
              presentation === "sheet" &&
                "w-full! max-w-[min(100%,var(--np-sheet-max-w))]!"
            )}
            {...props}
          >
            <OverlayChrome
              presentation={presentation}
              showCloseButton={showCloseButton}
            >
              {children}
            </OverlayChrome>
          </DrawerPrimitive.Popup>
        </DrawerPrimitive.Viewport>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.VirtualKeyboardProvider>
  )
}

/**
 * The title block, pinned to the top of the sheet with the close button in
 * its corner and, on a bottom sheet, the drag handle above the title.
 */
function SheetHeader({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const hidden = /(^|\s)sr-only(\s|$)/.test(className ?? "")
  const { presentation, closeButton, grabber } = useOverlayHeader(hidden)
  return (
    <div
      data-slot="sheet-header"
      className={cn(
        "flex shrink-0 flex-col gap-1 p-5 pb-3",
        !hidden && "sticky top-0 z-10 bg-surface",
        presentation === "sheet" && !hidden && "pt-0",
        closeButton && "pr-14",
        className
      )}
      {...props}
    >
      {grabber}
      {children}
      {closeButton}
    </div>
  )
}

/** The scrolling middle of a sheet (reference `.dialog-body`). */
function SheetBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-body"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-5 pt-2 pb-5",
        overlayScrollPaddingClassName,
        className
      )}
      {...props}
    />
  )
}

/**
 * The sheet's action row: the dialog's bar (sunken surface, hairline above)
 * pinned to the sheet's bottom and padded clear of the keyboard and the
 * home indicator. On a bottom sheet the buttons stack full width with the
 * primary (last) nearest the thumb; on a panel they sit right-aligned.
 */
function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  const presentation = useOverlayChrome()?.presentation ?? "panel"
  return (
    <div
      data-slot="sheet-footer"
      data-docked=""
      className={cn(
        "sticky bottom-0 z-10 mt-auto shrink-0 border-t border-line bg-surface-alt px-5 pt-3",
        overlayFooterClassName[presentation === "sheet" ? "sheet" : "dialog"],
        className,
        overlayFooterDockClassName
      )}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-section font-semibold text-ink", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-ui text-ink-muted", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetBody,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
