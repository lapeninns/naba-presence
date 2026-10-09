"use client"

import * as React from "react"
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  overlayCloseButtonClassName,
  overlayFooterClassName,
} from "@/components/ui/dialog"

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-scrim transition-opacity duration-(--np-duration-standard) ease-standard data-ending-style:opacity-0 data-ending-style:duration-(--np-duration-fast) data-starting-style:opacity-0",
        className
      )}
      {...props}
    />
  )
}

type SheetSide = "top" | "right" | "bottom" | "left"

/**
 * Reference `dialog.sheet`.
 *
 * `right` (the default) is a full-height panel from the right edge,
 * min(560px, 100vw) wide (`size="wide"`: 880px). At 640px and below it
 * becomes a bottom sheet 92dvh tall with 20px top corners and a grabber.
 * `left` stays a left panel at every width (a navigation drawer).
 * `bottom` is always a bottom sheet (centred, at most 672px wide from `sm`);
 * `top` drops from the top edge. Enter slides 24px and fades.
 */
const sheetSideClassName: Record<SheetSide, string> = {
  right: cn(
    "inset-x-0 bottom-0 h-[92dvh] rounded-t-(--np-radius-sheet) data-ending-style:translate-y-6 data-starting-style:translate-y-6",
    "sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:h-dvh sm:max-h-dvh sm:w-[min(560px,100vw)] sm:rounded-none sm:data-ending-style:translate-x-6 sm:data-ending-style:translate-y-0 sm:data-starting-style:translate-x-6 sm:data-starting-style:translate-y-0 sm:data-[size=wide]:w-[min(880px,100vw)]"
  ),
  left: "inset-y-0 left-0 h-dvh w-[min(300px,86vw)] data-ending-style:-translate-x-full data-starting-style:-translate-x-full",
  top: "inset-x-0 top-0 max-h-[92dvh] rounded-b-(--np-radius-sheet) data-ending-style:-translate-y-full data-starting-style:-translate-y-full",
  bottom:
    "inset-x-0 bottom-0 mx-auto max-h-[calc(100dvh-1.5rem)] w-full rounded-t-(--np-radius-sheet) data-ending-style:translate-y-full data-starting-style:translate-y-full sm:max-w-2xl",
}

function SheetContent({
  className,
  children,
  side = "right",
  size = "default",
  showCloseButton = true,
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: SheetSide
  size?: "default" | "wide"
  showCloseButton?: boolean
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        data-size={size}
        className={cn(
          "fixed z-50 flex flex-col overflow-y-auto overscroll-contain bg-surface text-body text-ink shadow-(--np-shadow-modal) outline-none [--dlg-pad:20px]",
          "transition-[translate,opacity] duration-(--np-duration-standard) ease-spring data-ending-style:opacity-0 data-ending-style:duration-(--np-duration-fast) data-ending-style:ease-standard data-starting-style:opacity-0",
          sheetSideClassName[side],
          className
        )}
        {...props}
      >
        {side === "right" || side === "bottom" ? (
          <span
            aria-hidden="true"
            data-slot="sheet-grabber"
            className={cn(
              "mx-auto mt-2 h-[5px] w-9 shrink-0 rounded-(--np-radius-pill) bg-line-strong",
              side === "right" && "sm:hidden"
            )}
          />
        ) : null}
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
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
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex shrink-0 flex-col gap-1 p-5 pr-14 pb-3", className)}
      {...props}
    />
  )
}

/** The scrolling middle of a sheet (reference `.dialog-body`). */
function SheetBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-body"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pt-2 pb-5",
        className
      )}
      {...props}
    />
  )
}

/**
 * The sheet's action row: the dialog's bar (sunken surface, hairline above)
 * pinned to the sheet's bottom, with safe-area padding on a phone.
 */
function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        "sticky bottom-0 mt-auto shrink-0 border-t border-line bg-surface-alt px-5 py-3 pb-[max(12px,env(safe-area-inset-bottom))]",
        overlayFooterClassName,
        className
      )}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-section font-semibold text-ink", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
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
