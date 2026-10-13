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

const baseToastManager = ToastPrimitive.createToastManager()

/**
 * The app's toast manager. Its `add` applies the same defaults as
 * `useToastManager` (see `withToastDefaults`), so module-level callers that
 * import `toast` directly get them too.
 */
const toast: typeof baseToastManager = {
  ...baseToastManager,
  add: (options) => baseToastManager.add(withToastDefaults(options)),
}

function ToastProvider({ ...props }: ToastPrimitive.Provider.Props) {
  return <ToastPrimitive.Provider {...props} />
}

function ToastPortal({ ...props }: ToastPrimitive.Portal.Props) {
  return <ToastPrimitive.Portal data-slot="toast-portal" {...props} />
}

/** The toast column's widest extent from the right edge: 380px + 16px inset. */
const TOAST_COLUMN = 396

const MODAL_FOOTERS =
  '[data-slot="sheet-content"] [data-slot="sheet-footer"], [data-slot="dialog-content"] [data-slot="dialog-footer"]'

/**
 * How far above the viewport's bottom edge an open sheet or dialog footer
 * reaches, when that footer runs under the toast column. From 640px the
 * toasts sit bottom-right, exactly where a right-hand sheet keeps its
 * actions ("Read saved outcome", "Refresh observation"), so the stack is
 * lifted clear of the footer rather than covering the recovery action a
 * warning toast points at.
 */
export function modalFooterClearance(
  root: ParentNode,
  viewport: { width: number; height: number }
): number {
  let top = viewport.height
  for (const footer of root.querySelectorAll(MODAL_FOOTERS)) {
    const rect = footer.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    if (rect.right <= viewport.width - TOAST_COLUMN) continue
    if (rect.bottom <= 0 || rect.top >= viewport.height) continue
    top = Math.min(top, rect.top)
  }
  return Math.max(0, Math.ceil(viewport.height - top))
}

function useModalFooterClearance() {
  const [clearance, setClearance] = React.useState(0)
  React.useEffect(() => {
    const measure = () =>
      setClearance(
        modalFooterClearance(document, {
          width: window.innerWidth,
          height: window.innerHeight,
        })
      )
    const observer = new MutationObserver(measure)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-open", "data-closed", "data-slot", "hidden"],
    })
    window.addEventListener("resize", measure)
    // A sheet slides in: measure again once its transition settles.
    document.addEventListener("transitionend", measure, true)
    measure()
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", measure)
      document.removeEventListener("transitionend", measure, true)
    }
  }, [])
  return clearance
}

/**
 * Where the stack sits (spec: "Toasts dock to the bottom on a phone, above
 * whichever bar owns the edge"). Always the bottom edge, stacking upward:
 * an Undo belongs under the thumb, not over the app bar (prim-03).
 *
 * `--toast-edge` is the height of whatever owns the bottom edge, decided in
 * CSS from the CHROME CONTRACT attributes (globals.css), so no JS measures
 * the shell:
 *   phone, docked ActionBar (`data-docked="bottom"`)   the action bar plus
 *                                                      `--np-dock-bottom`
 *   phone, tab bar showing (`data-slot="tab-bar"`, no  the tab bar plus the
 *     docked bar, keyboard closed)                     home indicator
 *   phone otherwise (no bar, or the keyboard is up)    `--np-dock-bottom`
 *   from `md`                                          the safe-area inset
 * An open sheet or dialog footer lifts the stack further (see
 * `modalFooterClearance`); the larger of the two wins. Full width less 16px
 * gutters on a phone; a 380px column at the right from `sm`. Above every
 * overlay (`z-toast`), so a result is never hidden by the sheet that caused
 * it.
 */
const VIEWPORT_CLASS = cn(
  "pointer-events-none fixed right-4 bottom-(--toast-bottom) left-4 z-toast w-auto outline-none sm:left-auto sm:w-95",
  "[--toast-gap:--spacing(2)] md:[--toast-gap:--spacing(4)]",
  "[--toast-edge:var(--np-dock-bottom)] md:[--toast-edge:var(--np-safe-bottom)]",
  "max-md:[html:not([data-keyboard=open])_body:has([data-slot=tab-bar]):not(:has([data-docked=bottom]))_&]:[--toast-edge:calc(var(--np-tabbar-h)+var(--np-safe-bottom))]",
  "max-md:[body:has([data-docked=bottom])_&]:[--toast-edge:calc(var(--np-actionbar-h)+var(--np-dock-bottom))]",
  "[--toast-bottom:calc(max(var(--toast-edge),var(--toast-footer-clearance))+var(--toast-gap))]"
)

function ToastViewport({
  className,
  style,
  ...props
}: ToastPrimitive.Viewport.Props) {
  const clearance = useModalFooterClearance()
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      data-footer-clearance={clearance > 0 ? clearance : undefined}
      className={cn(VIEWPORT_CLASS, className)}
      style={(state) => ({
        ...(typeof style === "function" ? style(state) : style),
        ["--toast-footer-clearance" as string]: `${clearance}px`,
      })}
      {...props}
    />
  )
}

function Toast({ className, ...props }: ToastPrimitive.Root.Props) {
  // `--dir` is the stacking direction: -1 stacks upward from the bottom edge,
  // which is where the stack now sits at every width. Every offset below is
  // multiplied by it so the transforms read as one set. Enter and exit
  // slide along the same axis on the spring.
  return (
    <ToastPrimitive.Root
      data-slot="toast"
      className={cn(
        "group/toast pointer-events-auto [[data-base-ui-inert]_&]:pointer-events-none absolute right-0 bottom-0 w-full origin-bottom rounded-(--np-radius-card) bg-charcoal text-ink-on-charcoal shadow-np-pop will-change-transform outline-none select-none focus-visible:[box-shadow:0_0_0_2px_var(--np-surface-canvas),0_0_0_4px_var(--np-focus-ring)]",
        // design-exempt R4: per-toast order inside the toast layer, from Base UI's --toast-index
        "z-[calc(1000-var(--toast-index))]",
        "[--dir:-1] [--gap:--spacing(2)] [--peek:--spacing(3)] [--height:var(--toast-frontmost-height,var(--toast-height))] [--scale:calc(max(0,1-(var(--toast-index)*0.1)))] [--shrink:calc(1-var(--scale))] [--offset-y:calc(var(--dir)*(var(--toast-offset-y)+var(--toast-index)*var(--gap))+var(--toast-swipe-movement-y))]",
        "h-(--height) [transform:translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)+var(--dir)*(var(--toast-index)*var(--peek)+var(--shrink)*var(--height))))_scale(var(--scale))] [transition:transform_var(--np-duration-overlay)_var(--np-ease-spring),opacity_var(--np-duration-standard)_var(--np-ease-standard),height_var(--np-duration-fast)_var(--np-ease-standard)]",
        // A hover bridge across the gap to the next toast (above this one),
        // so an expanded stack does not collapse while the pointer crosses
        // between rows.
        "after:absolute after:bottom-full after:left-0 after:h-[calc(var(--gap)+1px)] after:w-full after:content-['']",
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
 * Its hit area overhangs the words to 44px tall (the toast's own padding
 * holds the overhang, so the content's `overflow-hidden` does not clip it):
 * an Undo is the one thing in a toast a thumb must not miss.
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
        "relative shrink-0 self-center rounded-(--np-radius-tag) text-ui font-semibold text-ink-on-charcoal underline underline-offset-3 after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-charcoal",
        className
      )}
      {...props}
    />
  )
}

/**
 * The visible dismiss, always drawn: swiping is never the only way to close
 * a toast (WCAG 2.5.7). 28px drawn, 44px to the touch (the `::after`
 * overhang), the drawn size under `desk`.
 */
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
        "relative -my-1 -mr-1.5 size-7 shrink-0 text-ink-muted-on-charcoal after:absolute after:-inset-2 after:content-[''] hover:bg-ink-on-charcoal/10 hover:text-ink-on-charcoal focus-visible:shadow-none focus-visible:outline-2 focus-visible:outline-ink-on-charcoal desk:after:inset-0 [&_svg]:[stroke-width:1.75]",
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
    // The stack sits on the bottom edge: swipe it down or sideways off the
    // screen. The close button is the non-gesture alternative.
    <Toast
      key={toastItem.id}
      toast={toastItem}
      swipeDirection={["down", "right", "left"]}
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
 * How long an error toast stays up when the caller does not say. Five
 * seconds is too short to read what failed and decide what to do. It keeps
 * the default (polite) priority: Base UI's "high" priority mirrors the text
 * into a second, assertive region, which doubles every error. Not
 * "until dismissed": a stack of stale errors over the bottom edge would
 * cover the very bar the operator needs to retry from. The durable record
 * of a failure belongs inline beside the item (OperationOutcomeNotice).
 */
export const ERROR_TOAST_TIMEOUT = 20_000

/**
 * Every default the app applies to a new toast: the longer timeout for an
 * action toast (`withActionTimeout`), and for an error the longer
 * `ERROR_TOAST_TIMEOUT`. A caller's own `timeout` always wins.
 */
export function withToastDefaults<T extends AddOptions>(
  options: T
): T & { timeout?: number } {
  const withAction = withActionTimeout(options)
  if (options.type !== "error") return withAction
  return { ...withAction, timeout: withAction.timeout ?? ERROR_TOAST_TIMEOUT }
}

/**
 * The toast manager, with `add` applying `withToastDefaults`.
 * Every in-app caller reads toasts through this, so the rule holds without
 * each one remembering it.
 */
function useToastManager() {
  const manager = ToastPrimitive.useToastManager()
  const { add } = manager
  const wrappedAdd = React.useCallback<typeof add>(
    (options) => add(withToastDefaults(options)),
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
