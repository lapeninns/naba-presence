"use client"

import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer"
import { XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useMediaQuery } from "@/lib/hooks/use-media-query"
import { mediaQuery } from "@/lib/ui/breakpoints"
import { cn } from "@/lib/utils"

/**
 * The one overlay foundation under Dialog, Sheet and AlertDialog.
 *
 * Every modal surface is the same anatomy: a scrim, a popup, a pinned
 * header (title and close), a body that scrolls, and a pinned footer that
 * clears the on-screen keyboard and the home indicator. What changes is the
 * presentation: where the popup sits and how it leaves.
 *
 *   dialog  centred card, scales in, no gesture
 *   sheet   bottom sheet: rises, swipes down to dismiss, can snap
 *   panel   right side panel on wider screens, swipes right
 *   drawer  left navigation drawer, swipes left
 *
 * Dialog and Sheet roots are Base UI's Drawer root, which is the Dialog root
 * plus gesture state, so Dialog parts (Title, Close, Popup) work under it and
 * a content component can pick a centred Dialog popup or a swipeable Drawer
 * popup when it opens. AlertDialog keeps its own root (role `alertdialog`,
 * no outside-press dismissal) and borrows the recipes only.
 */

/* ---- Presentation ------------------------------------------------------ */

/**
 * When an `auto` overlay becomes a bottom sheet: a phone in portrait (below
 * the `sm` 40rem breakpoint), or a touch screen too short for a centred
 * card (a phone in landscape is 844px wide but 390px tall; the keyboard
 * takes half of that, and a sheet's footer docks to the keyboard where a
 * card's cannot). Keeping landscape phones on the sheet also means rotating
 * the phone never swaps the popup out from under a half-filled form.
 */
export const PHONE_OVERLAY_QUERY = mediaQuery("phoneOverlay")

/** Whether overlays present as sheets here. jsdom and the server read false. */
export function usePhoneOverlay(): boolean {
  return useMediaQuery(PHONE_OVERLAY_QUERY, false)
}

export type OverlayPresentation = "auto" | "dialog" | "sheet"

/**
 * Resolve `auto` against the viewport. Overlays render only while open, so
 * the media query is read on the client when the popup first mounts and
 * cannot mismatch hydration. Pass `open` to hold the answer while the
 * overlay is open: a window dragged across the breakpoint must not swap
 * the popup element (and remount the form in it) mid-task.
 */
export function useOverlayPresentation(
  requested: OverlayPresentation,
  open?: boolean
): "dialog" | "sheet" {
  const phone = usePhoneOverlay()
  const live = requested === "auto" ? (phone ? "sheet" : "dialog") : requested
  const [held, setHeld] = React.useState(live)
  if (open !== true && held !== live) setHeld(live)
  return open === true ? held : live
}

/* ---- Root: one open state, one close guard ----------------------------- */

type SwipeDirection = NonNullable<DrawerPrimitive.Root.Props["swipeDirection"]>

type OverlayRootContextValue = {
  open: boolean
  /** Content reports the direction its presentation is dismissed in. */
  setSwipeDirection: (direction: SwipeDirection) => void
}

const OverlayRootContext = React.createContext<OverlayRootContextValue | null>(
  null
)

export function useOverlayRoot() {
  return React.useContext(OverlayRootContext)
}

/** The words of the built-in "Discard changes?" confirmation. */
export type OverlayDiscardPrompt = {
  title?: React.ReactNode
  description?: React.ReactNode
  confirmLabel?: React.ReactNode
  cancelLabel?: React.ReactNode
}

export type OverlayRootProps = Omit<
  DrawerPrimitive.Root.Props,
  "children" | "onOpenChange"
> & {
  children?: React.ReactNode
  onOpenChange?: (
    open: boolean,
    eventDetails: DrawerPrimitive.Root.ChangeEventDetails
  ) => void
  /**
   * The overlay holds edits that a stray dismissal would lose. While true, a
   * scrim tap, Escape, the Android back gesture, a swipe and the header's
   * close button keep the overlay open and ask "Discard changes?" inside it.
   * A footer Cancel (`DialogClose`/`SheetClose`) and a Save that closes the
   * overlay itself are deliberate, and pass straight through (mark a Cancel
   * `data-overlay-close` to have it ask; `OverlayCancel` is marked).
   */
  dirty?: boolean
  /** Runs when the operator confirms the discard, before the overlay closes. */
  onDiscard?: () => void
  discardPrompt?: OverlayDiscardPrompt
}

/** Reasons a close can happen by accident, and so are guarded. */
const ACCIDENTAL_CLOSE = new Set<string>([
  "outside-press",
  "escape-key",
  "close-watcher",
  "swipe",
  "focus-out",
])

function isGuardedClose(details: DrawerPrimitive.Root.ChangeEventDetails) {
  if (ACCIDENTAL_CLOSE.has(details.reason)) return true
  // The header's ✕ is chrome, not a decision about the edits; a Close in the
  // footer is labelled ("Cancel", "Discard") and is one.
  if (details.reason !== "close-press") return false
  const target = details.event?.target
  return (
    target instanceof Element && target.closest("[data-overlay-close]") !== null
  )
}

export function OverlayRoot({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  actionsRef,
  dirty = false,
  onDiscard,
  discardPrompt,
  swipeDirection,
  children,
  ...props
}: OverlayRootProps) {
  // Mirrors Base UI's own state so content can hold its presentation while
  // open. The root stays uncontrolled when the caller left it so.
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
  const open = openProp ?? uncontrolledOpen
  const [reportedDirection, setSwipeDirection] =
    React.useState<SwipeDirection>("down")
  const [asking, setAsking] = React.useState(false)
  const actions = React.useRef<DrawerPrimitive.Root.Actions | null>(null)
  React.useImperativeHandle(
    actionsRef,
    () => ({
      close: () => actions.current?.close(),
      unmount: () => actions.current?.unmount(),
    }),
    []
  )

  const handleOpenChange = (
    next: boolean,
    details: DrawerPrimitive.Root.ChangeEventDetails
  ) => {
    if (!next && dirty && isGuardedClose(details)) {
      // Cancelling also springs a half-swiped sheet back into place.
      details.cancel()
      setAsking(true)
      return
    }
    onOpenChange?.(next, details)
    if (!details.isCanceled) setUncontrolledOpen(next)
  }

  const context = React.useMemo(() => ({ open, setSwipeDirection }), [open])

  return (
    <DrawerPrimitive.Root
      {...props}
      open={openProp}
      defaultOpen={defaultOpen}
      onOpenChange={handleOpenChange}
      actionsRef={actions}
      swipeDirection={swipeDirection ?? reportedDirection}
    >
      <OverlayRootContext.Provider value={context}>
        {children}
        <DiscardPrompt
          {...discardPrompt}
          open={asking}
          onKeep={() => setAsking(false)}
          onDiscard={() => {
            setAsking(false)
            onDiscard?.()
            // An imperative close is not guarded, and reaches the caller's
            // onOpenChange like any other close.
            actions.current?.close()
          }}
        />
      </OverlayRootContext.Provider>
    </DrawerPrimitive.Root>
  )
}

/**
 * Content calls this with the direction its presentation leaves in, before
 * paint, so the root's swipe handling matches what is drawn.
 */
export function useReportSwipeDirection(direction: SwipeDirection) {
  const root = useOverlayRoot()
  const setSwipeDirection = root?.setSwipeDirection
  React.useLayoutEffect(() => {
    setSwipeDirection?.(direction)
  }, [direction, setSwipeDirection])
}

/* ---- Recipes ----------------------------------------------------------- */

/**
 * The scrim: a flat, un-blurred veil at the scrim layer. Blur is reserved
 * for chrome materials; a modal backdrop only needs to push the page back.
 * It fades on the standard curve, leaves faster than it arrives, and while
 * a sheet is dragged it thins with the drag (`--drawer-swipe-progress`).
 */
export const overlayScrimClassName = cn(
  "fixed inset-0 isolate z-scrim bg-scrim",
  "opacity-[calc(1-var(--drawer-swipe-progress,0))] transition-opacity duration-(--np-duration-standard) ease-standard",
  "data-ending-style:opacity-0 data-ending-style:duration-(--np-duration-fast) data-starting-style:opacity-0 data-swiping:duration-0"
)

/**
 * The positioning layer a Drawer popup lives in: the whole viewport, above
 * the scrim. Base UI reads gestures here; a press on it outside the popup
 * is an outside press, so it behaves as the scrim.
 */
export const overlayViewportClassName = "fixed inset-0 z-overlay flex"

/**
 * Where a docked footer's bottom edge is, as `--overlay-dock`: the keyboard
 * while it is open (ours from ViewportInsets, or Base UI's own measurement
 * under the VirtualKeyboardProvider), otherwise the home indicator.
 */
const dockVariableClassName =
  "[--overlay-dock:max(var(--np-dock-bottom),var(--drawer-keyboard-inset,0px))]"

/**
 * The popup of each Drawer presentation. They share the surface, the modal
 * shadow and the 20px padding variable; each moves along its own axis with
 * the finger (`--drawer-swipe-movement-*`), takes no transition while
 * dragged, and rises on the sheet duration and the house ease-out. Reduced
 * motion collapses the duration in globals.css.
 */
const drawerPopupBaseClassName = cn(
  "relative flex flex-col overflow-y-auto overscroll-contain bg-surface text-body text-ink shadow-(--np-shadow-modal) outline-none [--dlg-pad:20px]",
  dockVariableClassName,
  "transition-transform duration-(--np-duration-sheet) ease-out-strong will-change-transform",
  "data-swiping:duration-0 data-swiping:select-none",
  "data-ending-style:duration-[calc(var(--drawer-swipe-strength,1)*var(--np-duration-sheet))]"
)

export const overlayPopupClassName = {
  /**
   * Reference `dialog.dialog`: min(520px, 100vw - 24px) wide (`wide`: 760),
   * at most min(86dvh, 760px) tall, centred, rising 8px as it fades in. An
   * iPad keyboard lifts it by half its height so the card stays clear.
   */
  dialog: cn(
    "fixed top-[calc(50%-var(--np-keyboard-inset)/2)] left-1/2 z-overlay grid max-h-[min(calc(86dvh-var(--np-keyboard-inset)),var(--np-dialog-max-h))] w-full max-w-[calc(100%-2*var(--np-overlay-gutter))] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto overscroll-contain rounded-(--np-radius-modal) bg-surface p-(--dlg-pad) text-body text-ink shadow-(--np-shadow-modal) outline-none [--dlg-pad:20px] [--overlay-dock:0px] sm:max-w-(--np-dialog-w) data-[size=wide]:sm:max-w-(--np-dialog-w-wide)",
    "transition-[opacity,scale,translate] duration-(--np-duration-standard) ease-spring data-ending-style:scale-[0.985] data-ending-style:opacity-0 data-ending-style:duration-(--np-duration-fast) data-ending-style:ease-standard data-starting-style:translate-y-[calc(-50%+--spacing(2))] data-starting-style:scale-[0.985] data-starting-style:opacity-0"
  ),
  /**
   * The bottom sheet: full width up to 40rem (centred beyond, for a phone
   * on its side), 20px top corners, no taller than the screen under the
   * status bar. Its height follows its content; snap points, when given,
   * offset it by `--drawer-snap-point-offset`. A second, solid shadow 3rem
   * under the bottom edge is the bleed that covers the gap an upward
   * over-drag would open (a pseudo-element would be clipped by the popup's
   * own scrolling; a shadow is not).
   */
  sheet: cn(
    drawerPopupBaseClassName,
    "mx-auto mt-auto max-h-[calc(100dvh-var(--np-safe-top)-0.75rem)] w-full max-w-[min(100%,var(--np-sheet-max-w))] rounded-t-(--np-radius-sheet)",
    "shadow-(--np-shadow-sheet)",
    "[transform:translateY(calc(var(--drawer-snap-point-offset,0px)+var(--drawer-swipe-movement-y,0px)))]",
    "data-ending-style:[transform:translateY(100%)] data-starting-style:[transform:translateY(100%)]"
  ),
  /**
   * The right side panel: full height, min(560px, 100vw) wide (`wide`:
   * 880px), slid in from the edge and swiped back to it.
   */
  panel: cn(
    drawerPopupBaseClassName,
    "ml-auto h-dvh max-h-dvh w-[min(var(--np-panel-w),100vw)] pr-safe data-[size=wide]:w-[min(var(--np-panel-w-wide),100vw)]",
    "[transform:translateX(var(--drawer-swipe-movement-x,0px))]",
    "data-ending-style:[transform:translateX(100%)] data-starting-style:[transform:translateX(100%)]"
  ),
  /**
   * The left navigation drawer: min(300px, 86vw), the full height, inside
   * the safe area. `left-0` and the width are the classes the shell's own
   * navigation drawer is drawn with, so it can move onto this unchanged.
   */
  drawer: cn(
    drawerPopupBaseClassName,
    "left-0 mr-auto h-dvh max-h-dvh w-[min(var(--np-drawer-w),86vw)] pt-safe pb-safe pl-safe",
    "[transform:translateX(var(--drawer-swipe-movement-x,0px))]",
    "data-ending-style:[transform:translateX(-100%)] data-starting-style:[transform:translateX(-100%)]"
  ),
  /**
   * The inset sheet (Notion Mail's short choice sheet): a card floating
   * `--np-sheet-inset` from the side edges and that gap above the dock edge
   * (`--np-dock-bottom`: the keyboard or the home indicator), rounded on
   * every corner. It is already clear of the dock, so a footer inside adds
   * no dock padding of its own (`--overlay-dock: 0`). It swipes down like the
   * bottom sheet, travelling its own height plus the gap so it leaves the
   * screen; reduced motion collapses the duration in globals.css, so it
   * appears and goes instantly.
   */
  inset: cn(
    drawerPopupBaseClassName,
    "[--overlay-dock:0px]",
    "mx-auto mt-auto mb-[calc(var(--np-dock-bottom)+var(--np-sheet-inset))] max-h-[calc(100dvh-var(--np-safe-top)-var(--np-dock-bottom)-3*var(--np-sheet-inset))] w-[calc(100%-2*var(--np-sheet-inset))] max-w-(--np-sheet-max-w) rounded-sheet-inset shadow-(--np-shadow-float)",
    "[transform:translateY(calc(var(--drawer-snap-point-offset,0px)+var(--drawer-swipe-movement-y,0px)))]",
    "data-ending-style:[transform:translateY(calc(100%+var(--np-dock-bottom)+var(--np-sheet-inset)))] data-starting-style:[transform:translateY(calc(100%+var(--np-dock-bottom)+var(--np-sheet-inset)))]"
  ),
  /** A sheet dropping from the top edge (kept for `side="top"`). */
  top: cn(
    drawerPopupBaseClassName,
    "mb-auto max-h-[92dvh] w-full rounded-b-(--np-radius-sheet) pt-safe",
    "[transform:translateY(var(--drawer-swipe-movement-y,0px))]",
    "data-ending-style:[transform:translateY(-100%)] data-starting-style:[transform:translateY(-100%)]"
  ),
} as const

/**
 * The ghost close button in the header's top-right corner (reference
 * `.dialog-close`). Exported for overlays that draw their own header.
 *
 * One recipe for every overlay: a left-aligned title (`overlayTitleClassName`),
 * this ✕ opposite it, the confirm as the footer's one primary (last in
 * source order, so nearest the thumb in a sheet), and no Cancel beside it:
 * the ✕ is the way out (`OverlayCancel` draws one only where there is no ✕).
 * A phone sheet of any kind, including a menu or select sheet, carries the
 * grabber at its top.
 */
export const overlayCloseButtonClassName =
  "absolute top-3.5 right-3.5 text-ink-muted hover:text-ink [&_svg]:size-4"

/**
 * The one title: left-aligned, the title role at 600, on every overlay
 * (dialog, sheet, panel) and on a menu or select sheet's header. A title
 * never centres: the close button owns the opposite corner.
 */
export const overlayTitleClassName =
  "text-left text-title font-semibold text-ink"

/**
 * The action row (reference `.dialog-foot`). In a dialog the buttons sit
 * right-aligned and wrap; in a sheet they stack full width with the primary
 * (last in source order) at the bottom, nearest the thumb. Full width comes
 * from `items-stretch`, not a width on each child: a footer that lays
 * itself out as a row (`flex-row justify-between`) must keep its buttons
 * their own size.
 */
export const overlayFooterClassName = {
  dialog: "flex flex-row flex-wrap justify-end gap-2",
  sheet: "flex flex-col items-stretch gap-2",
} as const

/**
 * A docked footer's bottom padding: 12px above `--overlay-dock`. It is
 * `!important` because the keyboard is not the caller's to forget: a footer
 * that sets its own bottom padding (for the home indicator, say) would
 * otherwise drop under the keyboard the moment a field below it is focused.
 */
export const overlayFooterDockClassName =
  "pb-[calc(--spacing(3)+var(--overlay-dock,0px))]!"

/**
 * The bar the footer is drawn as: the sunken surface under a hairline,
 * pinned to the bottom of the scrolling popup and padded clear of the
 * keyboard and home indicator (`--overlay-dock`). The negative offsets are
 * minus the popup's padding: sticky stops at the scroll container's
 * padding edge, which would leave the bar floating above the bottom.
 */
export const overlayFooterBarClassName =
  "sticky -bottom-(--dlg-pad) z-sticky -mx-(--dlg-pad) -mb-(--dlg-pad) mt-1 rounded-b-[inherit] border-t border-line bg-surface-alt px-(--dlg-pad) pt-3 " +
  overlayFooterDockClassName

/**
 * The alert's calm action row (Notion Mail's alert): the same pinning and
 * keyboard clearance as the footer bar, on the alert's own surface, with no
 * hairline and no sunken fill. An alert is one question; its answers sit
 * under the words rather than in a toolbar.
 */
export const overlayFooterCalmClassName =
  "sticky -bottom-(--dlg-pad) z-sticky -mx-(--dlg-pad) -mb-(--dlg-pad) mt-1 rounded-b-[inherit] bg-surface px-(--dlg-pad) pt-2 " +
  overlayFooterDockClassName

/**
 * Leave room under a pinned header and above a pinned footer when the
 * browser scrolls a focused field into view (WCAG 2.4.11), so a field the
 * keyboard lands on is never hidden behind either bar.
 */
export const overlayScrollPaddingClassName =
  "scroll-pt-20 scroll-pb-[calc(--spacing(24)+var(--overlay-dock,0px))]"

/* ---- Chrome ------------------------------------------------------------ */

/**
 * The header's close button. `data-overlay-close` marks it as chrome for the
 * close guard; it is the button alternative to every dismissal gesture
 * (WCAG 2.5.7).
 */
export function OverlayCloseButton({
  className,
  label = "Close",
}: {
  className?: string
  label?: string
}) {
  return (
    <DialogPrimitive.Close
      data-slot="overlay-close"
      data-overlay-close=""
      render={
        <Button
          variant="ghost"
          size="icon"
          className={cn(overlayCloseButtonClassName, className)}
          aria-label={label}
        />
      }
    >
      <XIcon aria-hidden="true" />
    </DialogPrimitive.Close>
  )
}

/**
 * The drag handle drawn at the top of a sheet. The whole sheet follows the
 * finger, and the handle sits in the pinned header, so a drag that starts
 * on it always dismisses, even when the body has scrolled. It is not a
 * control and takes no focus: the close button is the keyboard and switch
 * alternative.
 */
export function OverlayGrabber({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-slot="overlay-grabber"
      className={cn(
        "flex h-5 w-full shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing",
        className
      )}
    >
      <span className="h-(--np-sheet-grabber-h) w-9 rounded-(--np-radius-pill) bg-line-strong" />
    </span>
  )
}

/**
 * What a header needs from its content: where the overlay is drawn, and
 * whether the header should host the close button. A header that hosts it
 * keeps the ✕ pinned while the body scrolls; without a header the content
 * draws its own (which then scrolls with it).
 */
type OverlayChromeContextValue = {
  presentation: "dialog" | "sheet" | "panel" | "drawer" | "top"
  showCloseButton: boolean
  hostClose: (hosted: boolean) => void
  hostGrabber: (hosted: boolean) => void
}

const OverlayChromeContext =
  React.createContext<OverlayChromeContextValue | null>(null)

export function useOverlayChrome() {
  return React.useContext(OverlayChromeContext)
}

/**
 * Marks a component as an overlay header (SheetHeader, DialogHeader), so
 * `OverlayChrome` can keep it outside the drawer content: see
 * `splitLeadingHeaders`.
 */
const OVERLAY_HEADER = Symbol.for("naba.overlay-header")

export function markOverlayHeader<T extends object>(component: T): T {
  Object.defineProperty(component, OVERLAY_HEADER, { value: true })
  return component
}

function isOverlayHeader(node: React.ReactNode): boolean {
  if (!React.isValidElement(node)) return false
  const type = node.type as unknown
  return (
    (typeof type === "function" || typeof type === "object") &&
    type !== null &&
    (type as Record<symbol, unknown>)[OVERLAY_HEADER] === true
  )
}

/**
 * Split the content's leading headers (also inside a leading fragment) from
 * everything after them. Keys come from `Children.toArray`, which numbers
 * children by their place in the source, so a header that comes and goes
 * does not remount the body.
 */
function splitLeadingHeaders(children: React.ReactNode): {
  headers: React.ReactNode[]
  rest: React.ReactNode[]
} {
  const items = React.Children.toArray(children)
  const headers: React.ReactNode[] = []
  let index = 0
  while (index < items.length && isOverlayHeader(items[index])) {
    headers.push(items[index])
    index += 1
  }
  const next = items[index]
  if (
    headers.length === 0 &&
    React.isValidElement<{ children?: React.ReactNode }>(next) &&
    next.type === React.Fragment
  ) {
    const inner = splitLeadingHeaders(next.props.children)
    if (inner.headers.length > 0) {
      return {
        headers: [
          <React.Fragment key={next.key}>{inner.headers}</React.Fragment>,
        ],
        rest: [
          <React.Fragment key={next.key}>{inner.rest}</React.Fragment>,
          ...items.slice(index + 1),
        ],
      }
    }
  }
  return { headers, rest: items.slice(index) }
}

/**
 * Provide the chrome context, and report whether a header has taken the
 * close button and the handle. Where none did, the content draws them.
 *
 * On every Drawer presentation (all but `dialog`) the content after the
 * header is rendered inside Base UI's `Drawer.Content`. Base UI starts a
 * mouse or pen swipe on any press it does not recognise as a control
 * (`button, a, input, select, textarea, label, [role=button]`) and captures
 * the pointer, so a press on a radio's span or a `<summary>` would never
 * become a click. A press inside `Drawer.Content` is never a swipe start.
 * The header stays outside it, so a mouse drag on the handle or the title
 * still dismisses; touch swipes are arbitrated separately by Base UI and
 * work from anywhere in the sheet, as before. The wrapper is
 * `display: contents`, so the popup still lays out (and pins with
 * `sticky`) its own children exactly as it did.
 */
export function OverlayChrome({
  presentation,
  showCloseButton,
  children,
}: {
  presentation: OverlayChromeContextValue["presentation"]
  showCloseButton: boolean
  children: React.ReactNode
}) {
  const [hosted, setHosted] = React.useState(false)
  const [grabbed, setGrabbed] = React.useState(false)
  const value = React.useMemo(
    () => ({
      presentation,
      showCloseButton,
      hostClose: setHosted,
      hostGrabber: setGrabbed,
    }),
    [presentation, showCloseButton]
  )
  let body: React.ReactNode = children
  if (presentation !== "dialog") {
    const { headers, rest } = splitLeadingHeaders(children)
    body = (
      <>
        {headers}
        <DrawerPrimitive.Content
          data-slot="overlay-content"
          className="contents"
        >
          {rest}
        </DrawerPrimitive.Content>
      </>
    )
  }
  return (
    <OverlayChromeContext.Provider value={value}>
      {body}
      {presentation === "sheet" && !grabbed ? (
        // No header drew the handle (a visually hidden or absent header): a
        // phone sheet still carries one, over the popup's top padding.
        <OverlayGrabber className="absolute inset-x-0 top-0" />
      ) : null}
      {showCloseButton && !hosted ? <OverlayCloseButton /> : null}
    </OverlayChromeContext.Provider>
  )
}

/**
 * For a header: claim the close button (unless the header is visually
 * hidden, when the content must keep drawing it) and report what to draw.
 */
export function useOverlayHeader(visuallyHidden: boolean) {
  const chrome = useOverlayChrome()
  const hostClose = chrome?.hostClose
  const hostGrabber = chrome?.hostGrabber
  const hosts = Boolean(chrome?.showCloseButton) && !visuallyHidden
  const grabs = !visuallyHidden && chrome?.presentation === "sheet"
  React.useLayoutEffect(() => {
    if (!hosts || !hostClose) return
    hostClose(true)
    return () => hostClose(false)
  }, [hosts, hostClose])
  React.useLayoutEffect(() => {
    if (!grabs || !hostGrabber) return
    hostGrabber(true)
    return () => hostGrabber(false)
  }, [grabs, hostGrabber])
  return {
    presentation: chrome?.presentation ?? "dialog",
    closeButton: hosts ? <OverlayCloseButton /> : null,
    grabber: grabs ? <OverlayGrabber /> : null,
  }
}

/**
 * The footer's Cancel, for the overlay that has no ✕ (`showCloseButton`
 * off): a ghost button that closes it. Where the ✕ exists it draws nothing,
 * so one overlay never offers two ways to say the same thing; the confirm
 * stays the footer's one primary. Marked as the overlay's close control, so
 * a dirty overlay asks before it throws edits away.
 */
export function OverlayCancel({
  children = "Cancel",
  ...props
}: Omit<DialogPrimitive.Close.Props, "render">) {
  const chrome = useOverlayChrome()
  if (chrome?.showCloseButton) return null
  return (
    <DialogPrimitive.Close
      data-slot="overlay-cancel"
      data-overlay-close=""
      render={<Button variant="ghost" />}
      {...props}
    >
      {children}
    </DialogPrimitive.Close>
  )
}

/* ---- Alert recipes, and the discard confirmation ------------------------ */

/**
 * The alert dialog's popup. A centred narrow card; on a phone a card
 * anchored to the bottom edge, so the answer is where the thumb is. It has
 * no gesture: an alert wants an explicit answer, and a swipe is not one.
 */
export const alertPopupClassName = {
  dialog: cn(
    overlayPopupClassName.dialog,
    "gap-3 data-[size=wide]:sm:max-w-(--np-dialog-w)"
  ),
  sheet: cn(
    "fixed inset-x-0 bottom-0 z-overlay mx-auto grid max-h-[calc(100dvh-var(--np-safe-top)-0.75rem)] w-full max-w-[min(100%,var(--np-sheet-max-w))] gap-3 overflow-y-auto overscroll-contain rounded-t-(--np-radius-sheet) bg-surface p-(--dlg-pad) pt-6 text-body text-ink shadow-(--np-shadow-modal) outline-none [--dlg-pad:20px]",
    dockVariableClassName,
    "transition-[translate,opacity] duration-(--np-duration-sheet) ease-out-strong data-ending-style:translate-y-full data-ending-style:duration-(--np-duration-standard) data-starting-style:translate-y-full"
  ),
} as const

/**
 * "Discard changes?" for an overlay with `dirty` set. Rendered inside the
 * overlay's root, so it is a nested alert over the overlay rather than a
 * second modal beside it; "Keep editing" is first in the DOM and takes
 * focus, so a reflexive Enter keeps the edits.
 */
function DiscardPrompt({
  open,
  onKeep,
  onDiscard,
  title = "Discard your changes?",
  description = "What you entered here has not been saved. Nothing is sent to Google.",
  confirmLabel = "Discard changes",
  cancelLabel = "Keep editing",
}: OverlayDiscardPrompt & {
  open: boolean
  onKeep: () => void
  onDiscard: () => void
}) {
  const presentation = useOverlayPresentation("auto")
  return (
    <AlertDialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onKeep()
      }}
    >
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Backdrop
          forceRender
          data-slot="alert-dialog-overlay"
          className={cn(overlayScrimClassName, "z-overlay")}
        />
        <AlertDialogPrimitive.Popup
          data-slot="discard-prompt"
          data-presentation={presentation}
          className={cn(alertPopupClassName[presentation], "z-popover")}
        >
          <AlertDialogPrimitive.Title className="text-title font-semibold text-ink">
            {title}
          </AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="text-ui text-ink-muted">
            {description}
          </AlertDialogPrimitive.Description>
          <div
            className={cn(
              overlayFooterClassName[presentation],
              overlayFooterCalmClassName,
              "mt-2"
            )}
          >
            <AlertDialogPrimitive.Close render={<Button variant="secondary" />}>
              {cancelLabel}
            </AlertDialogPrimitive.Close>
            <Button variant="danger" onClick={onDiscard}>
              {confirmLabel}
            </Button>
          </div>
        </AlertDialogPrimitive.Popup>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  )
}

export { DrawerPrimitive, DialogPrimitive }
