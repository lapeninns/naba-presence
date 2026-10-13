"use client"

import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"

import { cn } from "@/lib/utils"
import {
  alertPopupClassName,
  overlayFooterBarClassName,
  overlayFooterClassName,
  overlayScrimClassName,
  overlayScrollPaddingClassName,
  useOverlayPresentation,
  type OverlayPresentation,
} from "@/components/ui/overlay"

function AlertDialog(props: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}
function AlertDialogTrigger(props: AlertDialogPrimitive.Trigger.Props) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  )
}
function AlertDialogClose(props: AlertDialogPrimitive.Close.Props) {
  return (
    <AlertDialogPrimitive.Close data-slot="alert-dialog-close" {...props} />
  )
}

const AlertPresentationContext = React.createContext<"dialog" | "sheet">(
  "dialog"
)

/**
 * One question. A narrow centred card from `sm`; on a phone a card anchored
 * to the bottom edge, so the answer is under the thumb. There is no close
 * button and no swipe: the answer is one of the footer buttons, and the
 * destructive confirmation names the object it acts on ("Delete reply",
 * never "OK"). Base UI's AlertDialog never closes on an outside press.
 */
function AlertDialogContent({
  className,
  children,
  presentation = "auto",
  ...props
}: AlertDialogPrimitive.Popup.Props & {
  /** `auto`: a bottom card on a phone, centred from `sm`. */
  presentation?: OverlayPresentation
}) {
  const resolved = useOverlayPresentation(presentation)
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Backdrop
        data-slot="alert-dialog-overlay"
        className={overlayScrimClassName}
      />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        data-presentation={resolved}
        className={cn(
          alertPopupClassName[resolved],
          overlayScrollPaddingClassName,
          className
        )}
        {...props}
      >
        <AlertPresentationContext.Provider value={resolved}>
          {children}
        </AlertPresentationContext.Provider>
      </AlertDialogPrimitive.Popup>
    </AlertDialogPrimitive.Portal>
  )
}

function AlertDialogTitle({
  className,
  ...props
}: AlertDialogPrimitive.Title.Props) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("text-section font-semibold text-ink", className)}
      {...props}
    />
  )
}
function AlertDialogDescription({
  className,
  ...props
}: AlertDialogPrimitive.Description.Props) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-ui text-ink-muted", className)}
      {...props}
    />
  )
}

/**
 * The dialog's footer bar (sunken surface under a hairline, pinned to the
 * bottom, clear of the keyboard). Centred: a right-aligned row, primary on
 * the right. Phone: full-width buttons stacked with the primary (last in
 * source order) at the bottom, nearest the thumb.
 */
function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const presentation = React.useContext(AlertPresentationContext)
  return (
    <div
      data-slot="alert-dialog-footer"
      data-docked=""
      className={cn(
        overlayFooterClassName[presentation],
        overlayFooterBarClassName,
        "mt-2",
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
