"use client"

import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"

import { cn } from "@/lib/utils"

function AlertDialog(props: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}
function AlertDialogTrigger(props: AlertDialogPrimitive.Trigger.Props) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
}
function AlertDialogClose(props: AlertDialogPrimitive.Close.Props) {
  return <AlertDialogPrimitive.Close data-slot="alert-dialog-close" {...props} />
}

/**
 * A narrow, centred panel for one question. There is no close button: the
 * answer is one of the footer buttons, and the destructive confirmation
 * names the object it acts on ("Delete reply", never "OK").
 */
function AlertDialogContent({ className, children, ...props }: AlertDialogPrimitive.Popup.Props) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Backdrop
        data-slot="alert-dialog-overlay"
        className="fixed inset-0 isolate z-50 bg-(--np-scrim) transition-opacity duration-(--np-duration-standard) ease-standard data-starting-style:opacity-0 data-ending-style:opacity-0 data-ending-style:duration-(--np-duration-fast)"
      />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-(--np-radius-modal) bg-popover p-6 text-body text-popover-foreground shadow-(--np-shadow-modal) outline-none sm:max-w-sm",
          "transition-[opacity,scale] duration-(--np-duration-overlay) ease-spring data-starting-style:scale-96 data-starting-style:opacity-0 data-ending-style:scale-96 data-ending-style:opacity-0 data-ending-style:duration-(--np-duration-fast) data-ending-style:ease-standard",
          className
        )}
        {...props}
      >
        {children}
      </AlertDialogPrimitive.Popup>
    </AlertDialogPrimitive.Portal>
  )
}

function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("text-section font-semibold text-ink", className)}
      {...props}
    />
  )
}
function AlertDialogDescription({ className, ...props }: AlertDialogPrimitive.Description.Props) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-body text-ink-muted", className)}
      {...props}
    />
  )
}

/**
 * Stacked full-width buttons on small screens (primary on top, because it is
 * last in source order and the column is reversed); a right-aligned row from
 * `sm` up with the primary on the right.
 */
function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "mt-2 flex flex-col-reverse gap-2 *:w-full sm:flex-row sm:justify-end sm:*:w-auto",
        className
      )}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
}
