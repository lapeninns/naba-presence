"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
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

/**
 * The scrim: a flat, un-blurred veil. Blur is reserved for chrome materials;
 * a modal backdrop only needs to push the page back. It fades on the standard
 * curve and leaves faster than it arrives.
 */
function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-scrim transition-opacity duration-(--np-duration-standard) ease-standard data-ending-style:opacity-0 data-ending-style:duration-(--np-duration-fast) data-starting-style:opacity-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * The ghost close button in the top-right corner (reference `.dialog-close`).
 * Exported because Sheet draws the same one.
 */
export const overlayCloseButtonClassName =
  "absolute top-3.5 right-3.5 text-ink-muted hover:text-ink [&_svg]:size-4"

/**
 * The action row both overlays end on (reference `.dialog-foot`): a bar on
 * the sunken surface under a hairline, buttons right-aligned and wrapping;
 * stacked on a phone with the primary on top where the thumb reaches it.
 */
export const overlayFooterClassName =
  "flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end"

/**
 * The bar drawing of the footer, pulled to the popup's edges. Below `sm` it
 * sticks to the bottom of the scrolling popup: on a phone a long body pushed
 * the confirm button below the fold, and the operator had to scroll a modal
 * to find out how to leave it. The offset is minus the panel's padding:
 * sticky stops at the scroll container's padding edge, which left the bar
 * floating 20px above the bottom with the body scrolling under it.
 */
const overlayFooterBarClassName =
  "-mx-(--dlg-pad) -mb-(--dlg-pad) mt-1 border-t border-line bg-surface-alt px-(--dlg-pad) py-3 rounded-b-[inherit] max-sm:sticky max-sm:-bottom-(--dlg-pad) max-sm:z-10"

function DialogContent({
  className,
  children,
  showCloseButton = true,
  size = "default",
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  /** `wide` is the reference `.dialog.wide` (760px) for a diff or table. */
  size?: "default" | "wide"
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        data-size={size}
        className={cn(
          // Reference `dialog.dialog`: surface, modal radius, pop shadow,
          // min(520px, 100vw - 24px) wide, at most min(86dvh, 760px) tall
          // with the body scrolling. Enter rises 8px and fades.
          "fixed top-1/2 left-1/2 z-50 grid max-h-[min(86dvh,760px)] w-full max-w-[calc(100%-24px)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto overscroll-contain rounded-(--np-radius-modal) bg-surface p-(--dlg-pad) text-body text-ink shadow-(--np-shadow-modal) outline-none [--dlg-pad:20px] sm:max-w-[520px] data-[size=wide]:sm:max-w-[760px]",
          "transition-[opacity,scale,translate] duration-(--np-duration-standard) ease-spring data-ending-style:scale-[0.985] data-ending-style:opacity-0 data-ending-style:duration-(--np-duration-fast) data-ending-style:ease-standard data-starting-style:translate-y-[calc(-50%+8px)] data-starting-style:scale-[0.985] data-starting-style:opacity-0",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className={overlayCloseButtonClassName}
                size="icon"
                aria-label="Close"
              />
            }
          >
            <XIcon aria-hidden="true" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1 pr-10", className)}
      {...props}
    />
  )
}

/**
 * Buttons stack on narrow screens and sit right-aligned on wide ones. Place
 * the primary action last in source order: it lands on the right in a row and
 * on top of the stack, where the thumb reaches first.
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
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        overlayFooterClassName,
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

/** A scrolling region between header and footer, for a long form. */
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
