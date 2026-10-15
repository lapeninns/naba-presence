"use client"

import * as React from "react"
import { ChevronLeftIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  DialogPrimitive,
  OverlayCloseButton,
  DrawerPrimitive,
  OverlayChrome,
  OverlayRoot,
  overlayFooterClassName,
  overlayFooterDockClassName,
  overlayPopupClassName,
  overlayScrimClassName,
  overlayScrollPaddingClassName,
  overlayTitleClassName,
  overlayViewportClassName,
  markOverlayHeader,
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
type SheetPresentation =
  "sheet" | "panel" | "drawer" | "top" | "inset" | "dialog"

/**
 * The sheet's look (`variant` on SheetContent):
 *
 *   edge   (the default) the edge sheet every existing caller gets, placed
 *          by `side` as below
 *   inset  a short choice list (7 rows or fewer: schedule presets, reminder,
 *          category, scope switcher, reply mode). On a phone a card floating
 *          `--np-sheet-inset` from the edges and above `--np-dock-bottom`,
 *          rounded on every corner, with the grabber and swipe-to-dismiss.
 *          From `sm` it is the centred dialog, as Dialog's `auto` is.
 *   full   a search picker or tag manager: the bottom sheet at its full
 *          height on a phone, the centred dialog from `sm`.
 *
 * Every variant's title is the one overlay title (`overlayTitleClassName`:
 * `text-title` 600, left-aligned). `inset` and `full` draw the header as a
 * bar: the title on the left, the ✕ (and the header's `action`, if any) on
 * the right; a pushed page puts a labelled back control (`SheetBack`) before
 * the title, and `page` on the header moves focus to the new title. A
 * confirm is either immediate (apply on tap, no button) or the header's
 * single `action` on the right ("Schedule", "Done"), never both. A sheet
 * with a footer confirm has no Cancel beside the ✕.
 */
export type SheetVariant = "edge" | "inset" | "full"

const SheetVariantContext = React.createContext<SheetVariant>("edge")

/**
 * The in-sheet page last shown by any header of this content. Held by the
 * content, not the header, so a caller that remounts its header on a push
 * (a keyed header, a header per page component) still gets focus moved.
 */
const SheetPageContext = React.createContext<React.RefObject<
  string | undefined
> | null>(null)

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
function presentationFor(
  side: SheetSide,
  variant: SheetVariant,
  phone: boolean
): SheetPresentation {
  if (variant === "inset") return phone ? "inset" : "dialog"
  if (variant === "full") return phone ? "sheet" : "dialog"
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
  inset: "down",
  dialog: "down",
} as const

/** How each presentation sits in the full-viewport layer. */
const viewportAlignClassName: Record<SheetPresentation, string> = {
  sheet: "items-end",
  panel: "justify-end",
  drawer: "justify-start",
  top: "items-start",
  inset: "items-end",
  dialog: "",
}

/** What the chrome (grabber, footer) treats each presentation as. */
const chromePresentationFor = {
  sheet: "sheet",
  panel: "panel",
  drawer: "drawer",
  top: "top",
  inset: "sheet",
  dialog: "dialog",
} as const

function SheetContent({
  className,
  children,
  side = "right",
  size = "default",
  variant = "edge",
  showCloseButton = true,
  overlayClassName,
  ...props
}: DrawerPrimitive.Popup.Props & {
  side?: SheetSide
  size?: "default" | "wide"
  /** `edge` (default), `inset` or `full`: see `SheetVariant`. */
  variant?: SheetVariant
  showCloseButton?: boolean
  /** Extra classes for the scrim (e.g. `md:hidden` for a phone-only drawer). */
  overlayClassName?: string
}) {
  const root = useOverlayRoot()
  // Held while open, like Dialog: a tablet rotated under an open sheet
  // keeps its drawing until it closes.
  const phone = usePhoneOverlay()
  const live = presentationFor(side, variant, phone)
  const [held, setHeld] = React.useState(live)
  if (!root?.open && held !== live) setHeld(live)
  const presentation = root?.open ? held : live
  useReportSwipeDirection(swipeDirectionFor[presentation])
  const pageRef = React.useRef<string | undefined>(undefined)

  const body = (
    <SheetVariantContext.Provider value={variant}>
      <SheetPageContext.Provider value={pageRef}>
        <OverlayChrome
          presentation={chromePresentationFor[presentation]}
          showCloseButton={showCloseButton}
        >
          {children}
        </OverlayChrome>
      </SheetPageContext.Provider>
    </SheetVariantContext.Provider>
  )

  if (presentation === "dialog") {
    // From `sm` an inset or full sheet is the centred dialog, drawn the way
    // DialogContent draws it (the Drawer root is the Dialog root).
    return (
      <DialogPrimitive.Portal data-slot="sheet-portal">
        <DialogPrimitive.Backdrop
          data-slot="sheet-overlay"
          className={cn(overlayScrimClassName, overlayClassName)}
        />
        <DialogPrimitive.Popup
          data-slot="sheet-content"
          data-side={side}
          data-size={size}
          data-variant={variant}
          data-presentation="dialog"
          className={cn(
            overlayPopupClassName.dialog,
            "flex flex-col gap-0 p-0",
            overlayScrollPaddingClassName,
            className
          )}
          {...(props as DialogPrimitive.Popup.Props)}
        >
          {body}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    )
  }

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
            data-variant={variant}
            data-presentation={presentation}
            className={cn(
              overlayPopupClassName[presentation],
              overlayScrollPaddingClassName,
              className,
              // A phone's sheet spans the screen whatever the panel width.
              presentation === "sheet" &&
                "w-full! max-w-[min(100%,var(--np-sheet-max-w))]!",
              // The full sheet stands at its full height (capped by the
              // sheet's own max height under the status bar).
              presentation === "sheet" && variant === "full" && "h-dvh"
            )}
            {...props}
          >
            {body}
          </DrawerPrimitive.Popup>
        </DrawerPrimitive.Viewport>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.VirtualKeyboardProvider>
  )
}

/**
 * The title block, pinned to the top of the sheet with the close button in
 * its corner and, on a bottom sheet, the drag handle above the title.
 *
 * On an `inset` or `full` sheet (or wherever `back` or `action` is given)
 * the header is a bar: the back control (if any), the left-aligned title,
 * and on the right the single header action beside the close button.
 *
 * `page` names the page an in-sheet push is showing. When it changes, focus
 * moves to the new title, so a screen reader hears where it landed and the
 * row that pushed (now gone) does not drop focus to the page. That holds
 * whether the caller updates one header or mounts a new one per page: a
 * header that mounts showing a different page from the last one, or that
 * mounts with `page` and `back` (a pushed page), takes focus to its title.
 */
const SheetHeader = markOverlayHeader(function SheetHeader({
  className,
  children,
  back,
  action,
  page,
  ...props
}: React.ComponentProps<"div"> & {
  /** A `SheetBack` for a pushed page. */
  back?: React.ReactNode
  /** The one confirm in the header ("Schedule", "Done"), on the right. */
  action?: React.ReactNode
  /** The in-sheet page shown; a change moves focus to the title. */
  page?: string
}) {
  const variant = React.useContext(SheetVariantContext)
  const hidden = /(^|\s)sr-only(\s|$)/.test(className ?? "")
  const { presentation, closeButton, grabber } = useOverlayHeader(hidden)
  const ref = React.useRef<HTMLDivElement>(null)
  const contentPage = React.useContext(SheetPageContext)
  const ownPage = React.useRef<string | undefined>(undefined)
  const shown = contentPage ?? ownPage
  const mounted = React.useRef(false)
  const hasBack = back !== undefined && back !== null && back !== false

  React.useEffect(() => {
    const firstRun = !mounted.current
    mounted.current = true
    const previous = shown.current
    shown.current = page
    if (page === undefined || previous === page) return
    // The very first page of a sheet keeps the overlay's own initial focus,
    // unless it is already a pushed page (it has a back control).
    if (previous === undefined && !(firstRun && hasBack)) return
    ref.current
      ?.querySelector<HTMLElement>('[data-slot="sheet-title"]')
      ?.focus()
    // `hasBack` is read on the run `page` changes in; it is not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, shown])

  const bar = !hidden && (variant !== "edge" || hasBack || Boolean(action))
  if (!bar) {
    return (
      <div
        ref={ref}
        data-slot="sheet-header"
        className={cn(
          "flex shrink-0 flex-col gap-1 p-5 pb-3",
          !hidden && "sticky top-0 z-sticky bg-surface",
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

  // The close button is never gone (WCAG 2.5.7): it stays on the right,
  // after the header's one action when there is one.
  const close = closeButton ? <OverlayCloseButton className="static" /> : null
  const trailing =
    action && close ? (
      <span className="flex items-center gap-1">
        {action}
        {close}
      </span>
    ) : (
      (action ?? close)
    )

  return (
    <div
      ref={ref}
      data-slot="sheet-header"
      data-variant={variant}
      className={cn(
        "sticky top-0 z-sticky flex shrink-0 flex-col bg-surface px-3 pb-2",
        presentation === "sheet" ? "pt-0" : "pt-3",
        className
      )}
      {...props}
    >
      {grabber}
      <div
        data-slot="sheet-header-bar"
        className={cn(
          "grid min-h-(--np-touch) items-center gap-2",
          // The title takes what the trailing control leaves; the trailing
          // cell keeps its control's width, so a long title or description
          // wraps beside the ✕ and never draws under it (FINAL-QA #4).
          hasBack
            ? "grid-cols-[auto_minmax(0,1fr)_auto]"
            : "grid-cols-[minmax(0,1fr)_auto] pl-2"
        )}
      >
        {hasBack ? (
          <div className="flex min-w-0 justify-start">{back}</div>
        ) : null}
        <div
          data-slot="sheet-header-title"
          className="flex min-w-0 flex-col items-start gap-0.5 text-left"
        >
          {children}
        </div>
        <div data-slot="sheet-header-trailing" className="flex justify-end">
          {trailing}
        </div>
      </div>
    </div>
  )
})

/**
 * The back control of a pushed in-sheet page: a chevron and the word
 * "Back", named in full for assistive tech ("Back to Set reminder"), 44px
 * on touch. The visible word starts the accessible name (WCAG 2.5.3).
 */
function SheetBack({
  to,
  className,
  ...props
}: Omit<React.ComponentProps<"button">, "children" | "aria-label"> & {
  /** The title of the page it returns to. */
  to: string
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      data-slot="sheet-back"
      aria-label={`Back to ${to}`}
      className={cn(
        "-ml-1 min-h-(--np-touch) min-w-(--np-touch) gap-1 px-2 text-ui text-ink-secondary [&_svg]:size-5",
        className
      )}
      {...props}
    >
      <ChevronLeftIcon aria-hidden="true" />
      <span>Back</span>
    </Button>
  )
}

/** The scrolling middle of a sheet (reference `.dialog-body`). */
function SheetBody({ className, ...props }: React.ComponentProps<"div">) {
  const variant = React.useContext(SheetVariantContext)
  return (
    <div
      data-slot="sheet-body"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-5 pt-2 pb-5",
        // Option rows carry their own padding and are the targets: the body
        // only keeps them off the rounded edge.
        variant === "inset" && "gap-1 px-2 pt-1 pb-3",
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
        "sticky bottom-0 z-sticky mt-auto shrink-0 border-t border-line bg-surface-alt px-5 pt-3",
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
      // Focusable from script only, so a push can land focus on it (any
      // variant: an edge sheet can push a page too).
      tabIndex={-1}
      className={cn(
        overlayTitleClassName,
        // A keyboard user who lands here after a push sees an inset ring.
        "rounded-(--np-radius-tag) outline-none focus-visible:ring-2 focus-visible:ring-(--np-focus-ring) focus-visible:ring-inset forced-colors:focus-visible:outline-2 forced-colors:focus-visible:-outline-offset-2",
        className
      )}
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
  SheetBack,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
