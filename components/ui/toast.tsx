"use client"

import * as React from "react"
import { Toast as ToastPrimitive } from "@base-ui/react/toast"
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

const toast = ToastPrimitive.createToastManager()

function ToastProvider({ ...props }: ToastPrimitive.Provider.Props) {
  return <ToastPrimitive.Provider {...props} />
}

function ToastPortal({ ...props }: ToastPrimitive.Portal.Props) {
  return <ToastPrimitive.Portal data-slot="toast-portal" {...props} />
}

/**
 * Reference `.toasts`: bottom-right, 16px in, min(380px, 100vw - 32px) wide,
 * stacking upward. Below 640px it spans the width at the TOP, under the
 * safe area, stacking downward: a phone's bottom edge belongs to sticky
 * action bars and bottom sheets (the review sheet's "Try again", the
 * editor's Publish), and a bottom toast covered exactly those.
 */
function ToastViewport({ className, ...props }: ToastPrimitive.Viewport.Props) {
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      className={cn(
        "pointer-events-none fixed top-[max(16px,env(safe-area-inset-top))] right-4 left-4 z-[120] w-auto outline-none sm:top-auto sm:bottom-[max(16px,env(safe-area-inset-bottom))] sm:left-auto sm:w-[min(380px,calc(100vw-32px))]",
        className
      )}
      {...props}
    />
  )
}

function Toast({ className, ...props }: ToastPrimitive.Root.Props) {
  // `--dir` is the stacking direction: -1 stacks upward from the bottom edge
  // (640px and up), +1 stacks downward from the top edge (phones). Every offset
  // below is multiplied by it so one set of transforms serves both anchors.
  // Enter and exit slide along the same axis on the spring.
  return (
    <ToastPrimitive.Root
      data-slot="toast"
      className={cn(
        "group/toast pointer-events-auto absolute top-0 right-0 z-[calc(1000-var(--toast-index))] w-full origin-top sm:top-auto sm:bottom-0 sm:origin-bottom rounded-(--np-radius-card) bg-charcoal text-ink-on-charcoal shadow-np-pop will-change-transform outline-none select-none focus-visible:[box-shadow:0_0_0_2px_var(--np-surface-canvas),0_0_0_4px_var(--np-focus-ring)]",
        "[--dir:1] [--gap:0.5rem] [--peek:0.75rem] [--height:var(--toast-frontmost-height,var(--toast-height))] [--scale:calc(max(0,1-(var(--toast-index)*0.1)))] [--shrink:calc(1-var(--scale))] [--offset-y:calc(var(--dir)*(var(--toast-offset-y)+var(--toast-index)*var(--gap))+var(--toast-swipe-movement-y))] sm:[--dir:-1]",
        "h-(--height) [transform:translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)+var(--dir)*(var(--toast-index)*var(--peek)+var(--shrink)*var(--height))))_scale(var(--scale))] [transition:transform_var(--np-duration-overlay)_var(--np-ease-spring),opacity_var(--np-duration-standard)_var(--np-ease-standard),height_var(--np-duration-fast)_var(--np-ease-standard)]",
        // A hover bridge across the gap to the next toast, on whichever side
        // the next toast sits, so an expanded stack does not collapse while
        // the pointer crosses between rows.
        "after:absolute after:top-full after:left-0 after:h-[calc(var(--gap)+1px)] after:w-full after:content-[''] sm:after:top-auto sm:after:bottom-full",
        "data-expanded:h-(--toast-height) data-expanded:[transform:translateX(var(--toast-swipe-movement-x))_translateY(var(--offset-y))]",
        "data-limited:opacity-0 data-starting-style:[transform:translateY(calc(var(--dir)*-150%))]",
        "[&[data-ending-style]:not([data-limited]):not([data-swipe-direction])]:[transform:translateY(calc(var(--dir)*-150%))]",
        "data-ending-style:data-[swipe-direction=down]:[transform:translateY(calc(var(--toast-swipe-movement-y)+150%))]",
        "data-ending-style:data-[swipe-direction=left]:[transform:translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))]",
        "data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]",
        "data-ending-style:data-[swipe-direction=up]:[transform:translateY(calc(var(--toast-swipe-movement-y)-150%))]",
        "data-expanded:data-ending-style:data-[swipe-direction=down]:[transform:translateY(calc(var(--toast-swipe-movement-y)+150%))]",
        "data-expanded:data-ending-style:data-[swipe-direction=left]:[transform:translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))]",
        "data-expanded:data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]",
        "data-expanded:data-ending-style:data-[swipe-direction=up]:[transform:translateY(calc(var(--toast-swipe-movement-y)-150%))]",
        className
      )}
      {...props}
    />
  )
}

function ToastContent({ className, ...props }: ToastPrimitive.Content.Props) {
  return (
    <ToastPrimitive.Content
      data-slot="toast-content"
      className={cn(
        "flex h-full items-start gap-2.5 overflow-hidden px-3.5 py-3 text-ui transition-opacity duration-(--np-duration-standard) ease-standard data-behind:opacity-0 data-expanded:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function ToastTitle({ className, ...props }: ToastPrimitive.Title.Props) {
  return (
    <ToastPrimitive.Title
      data-slot="toast-title"
      className={cn("text-ui font-semibold text-ink-on-charcoal", className)}
      {...props}
    />
  )
}

function ToastDescription({
  className,
  ...props
}: ToastPrimitive.Description.Props) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn("text-ui text-ink-muted-on-charcoal", className)}
      {...props}
    />
  )
}

/**
 * An underlined text action in the on-charcoal ink (reference `.toast
 * button`). One action per toast: a toast that needs a menu is a dialog.
 */
function ToastAction({
  className,
  render = <button type="button" />,
  ...props
}: ToastPrimitive.Action.Props) {
  return (
    <ToastPrimitive.Action
      data-slot="toast-action"
      render={render}
      className={cn(
        "relative shrink-0 self-center rounded-(--np-radius-tag) text-ui font-semibold text-ink-on-charcoal underline underline-offset-3 after:absolute after:-inset-2 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-charcoal",
        className
      )}
      {...props}
    />
  )
}

function ToastClose({
  className,
  children,
  render = <Button variant="ghost" size="icon-sm" aria-label="Close toast" />,
  ...props
}: ToastPrimitive.Close.Props) {
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      aria-label="Close toast"
      render={render}
      className={cn(
        "relative -my-1 -mr-1.5 size-7 shrink-0 text-ink-muted-on-charcoal after:absolute after:-inset-2 after:content-[''] hover:bg-ink-on-charcoal/10 hover:text-ink-on-charcoal focus-visible:shadow-none focus-visible:outline-2 focus-visible:outline-ink-on-charcoal pointer-coarse:size-7 [&_svg]:[stroke-width:1.75]",
        className
      )}
      {...props}
    >
      {children ?? <XIcon aria-hidden="true" />}
    </ToastPrimitive.Close>
  )
}

/**
 * The leading status glyph in the family's SOLID step, which reads on the
 * charcoal in both themes (reference `.toast-icon`). Loading uses a spinner
 * in the muted on-charcoal ink: it is not a status, it is the absence of one.
 */
function ToastIcon({ type }: { type: string | undefined }) {
  let icon: React.ReactNode = null

  if (type === "success") {
    icon = <CircleCheckIcon className="text-success-solid" aria-hidden="true" />
  }

  if (type === "info") {
    icon = <InfoIcon className="text-info-solid" aria-hidden="true" />
  }

  if (type === "warning") {
    icon = <TriangleAlertIcon className="text-warning-solid" aria-hidden="true" />
  }

  if (type === "error") {
    icon = <OctagonXIcon className="text-danger-solid" aria-hidden="true" />
  }

  if (type === "loading") {
    icon = (
      <Loader2Icon className="animate-spin text-ink-muted-on-charcoal" aria-hidden="true" />
    )
  }

  if (!icon) {
    return null
  }

  return (
    <span
      data-slot="toast-icon"
      className="mt-0.5 shrink-0 [&_svg]:pointer-events-none [&_svg]:[stroke-width:1.75] [&_svg:not([class*='size-'])]:size-4"
    >
      {icon}
    </span>
  )
}

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager()

  return toasts.map((toastItem) => (
    // Up dismisses a phone's top toast, down a desktop's bottom one.
    <Toast
      key={toastItem.id}
      toast={toastItem}
      swipeDirection={["up", "down", "right"]}
    >
      <ToastContent>
        <ToastIcon type={toastItem.type} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <ToastTitle />
          <ToastDescription />
        </div>
        <ToastAction />
        <ToastClose />
      </ToastContent>
    </Toast>
  ))
}

function Toaster({
  children,
  toastManager = toast,
  ...props
}: ToastPrimitive.Provider.Props) {
  return (
    <ToastProvider toastManager={toastManager} {...props}>
      {children}
      <ToastPortal>
        <ToastViewport>
          <ToastList />
        </ToastViewport>
      </ToastPortal>
    </ToastProvider>
  )
}

const createToastManager = ToastPrimitive.createToastManager

/**
 * How long a toast that carries an action (Undo, View) stays up when the
 * caller does not say. The default five seconds is enough to read a sentence,
 * not to read it, decide, and reach the button, so an Undo expired before
 * anyone could use it.
 */
export const ACTION_TOAST_TIMEOUT = 10_000

type AddOptions = Parameters<
  ReturnType<typeof ToastPrimitive.useToastManager>["add"]
>[0]

/** Gives an action-carrying toast the longer timeout unless one is set. */
export function withActionTimeout<T extends AddOptions>(
  options: T
): T & { timeout?: number } {
  if (!options.actionProps || options.timeout !== undefined) return options
  return { ...options, timeout: ACTION_TOAST_TIMEOUT }
}

/**
 * The toast manager, with `add` giving action toasts the longer timeout.
 * Every in-app caller reads toasts through this, so the rule holds without
 * each one remembering it.
 */
function useToastManager() {
  const manager = ToastPrimitive.useToastManager()
  const { add } = manager
  const wrappedAdd = React.useCallback<typeof add>(
    (options) => add(withActionTimeout(options)),
    [add]
  )
  return React.useMemo(
    () => ({ ...manager, add: wrappedAdd }),
    [manager, wrappedAdd]
  )
}

export {
  Toaster,
  Toast,
  ToastAction,
  ToastClose,
  ToastContent,
  ToastDescription,
  ToastPortal,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  createToastManager,
  toast,
  useToastManager,
}
