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
        "fixed inset-0 isolate z-50 bg-(--np-scrim) transition-opacity duration-(--np-duration-standard) ease-standard data-ending-style:opacity-0 data-ending-style:duration-(--np-duration-fast) data-starting-style:opacity-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * The small grey circle in the top-right corner. Exported because Sheet draws
 * the same one — it was a second copy of this string, which is exactly how
 * two overlays start closing differently.
 */
export const overlayCloseButtonClassName =
  "absolute top-4 right-4 size-7 rounded-(--np-radius-pill) bg-fill text-ink-muted hover:bg-fill-secondary hover:text-ink [&_svg]:size-3.5 [&_svg]:[stroke-width:1.75]"

/**
 * The action row both overlays end on: stacked on a phone with the primary
 * on top where the thumb reaches it, a right-aligned row from `sm` up.
 * Exported for the same reason as the close button.
 */
export const overlayFooterClassName =
  "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          // Enter: scale from 0.96 with a fade on the spring. Exit: the same
          // shape, but faster and without overshoot so dismissal feels
          // immediate. Position uses translate; scale is a separate property
          // in Tailwind v4, so the two never fight.
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-6 rounded-(--np-radius-modal) bg-popover p-6 text-body text-popover-foreground shadow-(--np-shadow-modal) outline-none sm:max-w-md",
          "transition-[opacity,scale] duration-(--np-duration-overlay) ease-spring data-ending-style:scale-96 data-ending-style:opacity-0 data-ending-style:duration-(--np-duration-fast) data-ending-style:ease-standard data-starting-style:scale-96 data-starting-style:opacity-0",
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
                size="icon-sm"
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
      className={cn("flex flex-col gap-1.5 pr-8", className)}
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
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(overlayFooterClassName, className)}
      {...props}
    >
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="secondary" />}>
          Close
        </DialogPrimitive.Close>
      )}
      {children}
    </div>
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
        "text-body text-ink-muted *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-ink",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
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
