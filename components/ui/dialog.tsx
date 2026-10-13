"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DialogPrimitive,
  DrawerPrimitive,
  OverlayChrome,
  OverlayRoot,
  overlayCloseButtonClassName,
  overlayFooterBarClassName,
  overlayFooterClassName as overlayFooterRecipe,
  overlayPopupClassName,
  overlayScrimClassName,
  overlayScrollPaddingClassName,
  overlayViewportClassName,
  markOverlayHeader,
  useOverlayChrome,
  useOverlayHeader,
  useOverlayPresentation,
  useOverlayRoot,
  useReportSwipeDirection,
  type OverlayDiscardPrompt,
  type OverlayPresentation,
} from "@/components/ui/overlay"

/**
 * A modal dialog that is responsive by default: a bottom sheet on a phone
 * (swipe down, or the ✕, to dismiss; the footer rides on the keyboard) and a
 * centred card from `sm`. `presentation` on the content pins one or the
 * other. `dirty` asks before an accidental dismissal throws edits away.
 *
 *   <Dialog open={open} onOpenChange={setOpen} dirty={edited}>
 *     <DialogContent>
 *       <DialogHeader><DialogTitle>Edit link</DialogTitle></DialogHeader>
 *       …fields…
 *       <DialogFooter>
 *         <DialogClose render={<Button variant="secondary" />}>Cancel</DialogClose>
 *         <Button onClick={save}>Save link</Button>
 *       </DialogFooter>
 *     </DialogContent>
 *   </Dialog>
 */
function Dialog({
  onOpenChange,
  actionsRef,
  handle,
  ...props
}: Omit<DialogPrimitive.Root.Props, "children"> & {
  children?: React.ReactNode
  dirty?: boolean
  onDiscard?: () => void
  discardPrompt?: OverlayDiscardPrompt
}) {
  // The Drawer root is the Dialog root plus gesture state; its change
  // reasons are a superset (it adds `swipe`), which a Dialog handler typed
  // for the narrower set reads safely.
  return (
    <OverlayRoot
      data-slot="dialog"
      {...props}
      onOpenChange={
        onOpenChange as React.ComponentProps<typeof OverlayRoot>["onOpenChange"]
      }
      actionsRef={actionsRef}
      handle={handle as DrawerPrimitive.Root.Props["handle"]}
    />
  )
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

/** The scrim (see `overlayScrimClassName`). */
function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(overlayScrimClassName, className)}
      {...props}
    />
  )
}

/**
 * The action row both overlays end on, in its centred-dialog drawing. Kept
 * as a string for callers that lay out their own footer.
 */
export const overlayFooterClassName = cn(
  overlayFooterRecipe.dialog,
  "max-sm:flex-col max-sm:items-stretch"
)
export { overlayCloseButtonClassName }

function DialogContent({
  className,
  children,
  showCloseButton = true,
  size = "default",
  presentation = "auto",
  overlayClassName,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  /** `wide` is the reference `.dialog.wide` (760px) for a diff or table. */
  size?: "default" | "wide"
  /**
   * `auto` (the default) is a bottom sheet on a phone and a centred dialog
   * from `sm`; `dialog` or `sheet` pins one of them at every width.
   */
  presentation?: OverlayPresentation
  /** Extra classes for the scrim. */
  overlayClassName?: string
}) {
  const root = useOverlayRoot()
  const resolved = useOverlayPresentation(presentation, root?.open)
  useReportSwipeDirection("down")

  // The popup is the scroller, in both drawings: the header and footer pin
  // themselves to its edges with `sticky`, which leaves every caller's
  // className (grid columns, padding, gap) applying where it always did.
  const body = (
    <OverlayChrome presentation={resolved} showCloseButton={showCloseButton}>
      {children}
    </OverlayChrome>
  )

  if (resolved === "sheet") {
    return (
      <DrawerPrimitive.VirtualKeyboardProvider>
        <DrawerPrimitive.Portal data-slot="dialog-portal">
          <DrawerPrimitive.Backdrop
            data-slot="dialog-overlay"
            className={cn(overlayScrimClassName, overlayClassName)}
          />
          <DrawerPrimitive.Viewport className={overlayViewportClassName}>
            <DrawerPrimitive.Popup
              data-slot="dialog-content"
              data-presentation="sheet"
              data-size={size}
              className={cn(
                overlayPopupClassName.sheet,
                "grid gap-4 p-(--dlg-pad)",
                overlayScrollPaddingClassName,
                className,
                // Whatever width a caller gave the card, a phone's sheet
                // spans the screen.
                "w-full! max-w-[min(100%,var(--np-sheet-max-w))]!"
              )}
              {...(props as DrawerPrimitive.Popup.Props)}
            >
              {body}
            </DrawerPrimitive.Popup>
          </DrawerPrimitive.Viewport>
        </DrawerPrimitive.Portal>
      </DrawerPrimitive.VirtualKeyboardProvider>
    )
  }

  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        data-presentation="dialog"
        data-size={size}
        className={cn(
          overlayPopupClassName.dialog,
          overlayScrollPaddingClassName,
          className
        )}
        {...props}
      >
        {body}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

/**
 * The title block, pinned to the top of the popup while the body scrolls,
 * with the close button in its corner. In a sheet the drag handle sits
 * above the title. A visually hidden header (`sr-only`) leaves the close
 * button to the content.
 */
const DialogHeader = markOverlayHeader(function DialogHeader({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const hidden = /(^|\s)sr-only(\s|$)/.test(className ?? "")
  const { presentation, closeButton, grabber } = useOverlayHeader(hidden)
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        "flex flex-col gap-1",
        !hidden &&
          "sticky -top-(--dlg-pad) z-10 -mx-(--dlg-pad) -mt-(--dlg-pad) -mb-2 bg-surface px-(--dlg-pad) pt-(--dlg-pad) pb-2",
        !hidden && presentation === "sheet" && "pt-0",
        closeButton && "pr-[calc(var(--dlg-pad)+2.25rem)]",
        className
      )}
      {...props}
    >
      {grabber}
      {children}
      {closeButton}
    </div>
  )
})

/**
 * The action row. In a centred dialog the buttons sit right-aligned; in a
 * sheet they stack full width with the primary nearest the thumb. Place the
 * primary action last in source order: it lands on the right in a row and
 * at the bottom of the stack. The bar pins to the popup's bottom edge and
 * rides on the on-screen keyboard.
 */
function DialogFooter({
  className,
  showCloseButton = false,
  plain = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
  /** Drop the sunken bar and keep a bare button row. */
  plain?: boolean
}) {
  const presentation = useOverlayChrome()?.presentation ?? "dialog"
  const stacked = presentation === "sheet"
  return (
    <div
      data-slot="dialog-footer"
      data-docked={plain ? undefined : ""}
      className={cn(
        overlayFooterRecipe[stacked ? "sheet" : "dialog"],
        !plain && overlayFooterBarClassName,
        className
      )}
      {...props}
    >
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="ghost" />}>
          Close
        </DialogPrimitive.Close>
      )}
      {children}
    </div>
  )
}

/** A region between header and footer, for a long form. */
function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn("flex min-w-0 flex-col gap-4", className)}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-section font-semibold text-ink", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-ui text-ink-muted *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-ink",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
