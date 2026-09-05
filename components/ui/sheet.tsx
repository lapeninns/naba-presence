"use client"

import * as React from "react"
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

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
        "fixed inset-0 z-50 bg-(--np-scrim) transition-opacity duration-(--np-duration-standard) ease-standard data-starting-style:opacity-0 data-ending-style:opacity-0 data-ending-style:duration-(--np-duration-fast)",
        className
      )}
      {...props}
    />
  )
}

type SheetSide = "top" | "right" | "bottom" | "left"

/**
 * Below `md` every side is a bottom sheet: rounded top corners, a grabber,
 * and a spring slide up from the bottom edge. From `md` up the `side` prop
 * takes over — left and right are full-height panels with no border, top
 * and bottom are edge sheets. Enter is a spring; exit is the standard curve
 * so dismissal never overshoots.
 */
const sheetSideClassName: Record<SheetSide, string> = {
  right:
    "md:inset-y-0 md:right-0 md:left-auto md:h-full md:max-h-none md:w-3/4 md:max-w-sm md:rounded-none md:data-starting-style:translate-y-0 md:data-starting-style:translate-x-full md:data-ending-style:translate-y-0 md:data-ending-style:translate-x-full",
  left: "md:inset-y-0 md:left-0 md:right-auto md:h-full md:max-h-none md:w-3/4 md:max-w-sm md:rounded-none md:data-starting-style:translate-y-0 md:data-starting-style:-translate-x-full md:data-ending-style:translate-y-0 md:data-ending-style:-translate-x-full",
  top: "md:inset-x-0 md:top-0 md:bottom-auto md:h-auto md:max-w-none md:rounded-t-none md:rounded-b-(--np-radius-sheet) md:data-starting-style:-translate-y-full md:data-ending-style:-translate-y-full",
  bottom: "md:max-w-2xl",
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: SheetSide
  showCloseButton?: boolean
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-50 flex flex-col bg-popover text-body text-popover-foreground shadow-(--np-shadow-modal) outline-none",
          "transition-[translate,opacity] duration-(--np-duration-overlay) ease-spring data-ending-style:duration-(--np-duration-standard) data-ending-style:ease-standard",
          // The bottom sheet every side collapses to on a narrow screen.
          "inset-x-0 bottom-0 mx-auto w-full max-h-[calc(100dvh-1.5rem)] rounded-t-(--np-radius-sheet) max-md:overflow-y-auto data-starting-style:translate-y-full data-ending-style:translate-y-full",
          sheetSideClassName[side],
          className
        )}
        {...props}
      >
        <span
          aria-hidden="true"
          data-slot="sheet-grabber"
          className={cn(
            "mx-auto mt-2 h-[5px] w-9 shrink-0 rounded-(--np-radius-pill) bg-ink-quaternary",
            side !== "bottom" && "md:hidden"
          )}
        />
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-4 right-4 size-7 rounded-(--np-radius-pill) bg-fill text-ink-muted hover:bg-fill-secondary hover:text-ink [&_svg]:size-3.5 [&_svg]:[stroke-width:1.75]"
                size="icon-sm"
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
      className={cn("flex flex-col gap-1.5 p-6 pr-14", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-6", className)}
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
      className={cn("text-body text-ink-muted", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
