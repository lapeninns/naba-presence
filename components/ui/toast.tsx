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
 *   phone, docked ActionBar (`data-docked="bottom"`)   the bar's measured
 *                                                      height (`--np-dock-bar-h`,
 *                                                      two rows when it wraps),
 *                                                      else the action bar plus
 *                                                      `--np-dock-bottom`
 *   phone, tab bar showing (`data-slot="tab-bar"`, no  the tab bar plus the
 *     docked bar, keyboard closed)                     home indicator
 *   phone otherwise (no bar, or the keyboard is up)    `--np-dock-bottom`
 *   from `md`                                          the safe-area inset
 * An open sheet or dialog footer lifts the stack further (see
 * `modalFooterClearance`); the larger of the two wins, plus an 8px gap on a
 * phone. A SelectionBar docks with the same `data-docked="bottom"` and
 * publishes the same measured height, so the stack clears it too. Full width
 * less the page gutters (`--np-page-pad-x`) on a phone; a 380px column at the
 * right from `sm`. Above every
 * overlay (`z-toast`), so a result is never hidden by the sheet that caused
 * it.
 */
const VIEWPORT_CLASS = cn(
  "pointer-events-none fixed right-(--np-page-pad-x) bottom-(--toast-bottom) left-(--np-page-pad-x) z-toast w-auto outline-none sm:right-4 sm:left-auto sm:w-95",
  "[--toast-gap:--spacing(2)] md:[--toast-gap:--spacing(4)]",
  "[--toast-edge:var(--np-dock-bottom)] md:[--toast-edge:var(--np-safe-bottom)]",
  "max-md:[html:not([data-keyboard=open])_body:has([data-slot=tab-bar]):not(:has([data-docked=bottom]))_&]:[--toast-edge:calc(var(--np-tabbar-h)+var(--np-safe-bottom))]",
  "max-md:[body:has([data-docked=bottom])_&]:[--toast-edge:var(--np-dock-bar-h,calc(var(--np-actionbar-h)+var(--np-dock-bottom)))]",
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
        "group/toast pointer-events-auto absolute right-0 bottom-0 w-full origin-bottom rounded-toast bg-charcoal text-ink-on-charcoal shadow-np-float will-change-transform outline-none select-none focus-visible:[box-shadow:0_0_0_2px_var(--np-surface-canvas),0_0_0_4px_var(--np-focus-ring)] [[data-base-ui-inert]_&]:pointer-events-none",
        // design-exempt R4: per-toast order inside the toast layer, from Base UI's --toast-index
        "z-[calc(1000-var(--toast-index))]",
        "[--dir:-1] [--gap:--spacing(2)] [--height:var(--toast-frontmost-height,var(--toast-height))] [--offset-y:calc(var(--dir)*(var(--toast-offset-y)+var(--toast-index)*var(--gap))+var(--toast-swipe-movement-y))] [--peek:--spacing(3)] [--scale:calc(max(0,1-(var(--toast-index)*0.1)))] [--shrink:calc(1-var(--scale))]",
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
        // At least 52px (NM's toast), one line: glyph, the words, then the
        // trailing action and the close at 44px each, which is what sets the
        // floor (44 + 2 x 4px).
        "flex h-full min-h-13 items-center gap-3 overflow-hidden py-1 pr-1.5 pl-4 text-body transition-opacity duration-(--np-duration-standard) ease-standard data-behind:opacity-0 data-expanded:opacity-100",
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
      className={cn("text-body font-medium text-ink-on-charcoal", className)}
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
 * The trailing text action in the on-charcoal ink (NM's "Undo"). One action
 * per toast: a toast that needs a menu is a dialog. A real 44px box at every
 * width, not an overhang: an Undo is the one thing in a toast a thumb must
 * not miss. Undo is for LOCAL reversible actions only (D5); a Google write
 * gets `ToastLink` ("View on Google") or nothing. `showToast` and
 * `toastProgress` enforce that in their types.
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
      className={cn(TOAST_TRAILING_ACTION, className)}
      {...props}
    />
  )
}

const TOAST_TRAILING_ACTION =
  "inline-flex min-h-(--np-touch) min-w-(--np-touch) shrink-0 items-center justify-center self-center rounded-(--np-radius-control) px-3 text-body font-semibold text-ink-on-charcoal outline-none hover-fine:hover:bg-ink-on-charcoal/10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink-on-charcoal"

/**
 * A trailing link in the action's place: the one thing a Google-write toast
 * may carry ("View on Google", D5). It opens in a new tab, so the result the
 * toast reports is still here when the operator comes back.
 */
function ToastLink({
  className,
  children = "View on Google",
  ...props
}: React.ComponentProps<"a">) {
  return (
    <a
      data-slot="toast-link"
      target="_blank"
      rel="noopener noreferrer"
      className={cn(TOAST_TRAILING_ACTION, className)}
      {...props}
    >
      {children}
    </a>
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
        "relative size-7 shrink-0 self-center text-ink-muted-on-charcoal after:absolute after:-inset-2 after:content-[''] hover:bg-ink-on-charcoal/10 hover:text-ink-on-charcoal focus-visible:shadow-none focus-visible:outline-2 focus-visible:outline-ink-on-charcoal desk:after:inset-0 [&_svg]:[stroke-width:1.75]",
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
    icon = (
      <TriangleAlertIcon className="text-warning-solid" aria-hidden="true" />
    )
  }

  if (type === "error") {
    icon = <OctagonXIcon className="text-danger-solid" aria-hidden="true" />
  }

  if (type === "loading") {
    icon = (
      <Loader2Icon
        className="animate-spin text-ink-muted-on-charcoal motion-reduce:animate-none"
        aria-hidden="true"
      />
    )
  }

  if (!icon) {
    return null
  }

  return (
    <span
      data-slot="toast-icon"
      className="shrink-0 self-center [&_svg]:pointer-events-none [&_svg]:[stroke-width:1.75] [&_svg:not([class*='size-'])]:size-5"
    >
      {icon}
    </span>
  )
}

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager()

  return toasts.map((toastItem) => {
    const data = readToastData(toastItem.data)
    // A Google write never carries an Undo (D5), even if a caller hands the
    // raw manager one: only its "View on Google" link is drawn.
    const google = data.kind === "google"
    return (
      // The stack sits on the bottom edge: swipe it down or sideways off the
      // screen. The close button is the non-gesture alternative.
      <Toast
        key={toastItem.id}
        toast={toastItem}
        data-kind={data.kind}
        data-phase={toastItem.type === "loading" ? "progress" : "result"}
        swipeDirection={["down", "right", "left"]}
      >
        <ToastContent>
          <ToastIcon type={toastItem.type} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-2">
            <ToastTitle />
            <ToastDescription />
          </div>
          {google ? null : <ToastAction />}
          {data.link ? <ToastLink href={data.link.href} /> : null}
          <ToastClose />
        </ToastContent>
      </Toast>
    )
  })
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

/* ------------------------------------------------------------------------ *
 * Outcome toasts: phases, Undo and the Google-write variant (brief §4.3, D5)
 * ------------------------------------------------------------------------ */

/**
 * Who a toast reports on. `local`: something reversible inside the app
 * (mark done, tag, assign); it may offer Undo. `google`: a write that
 * reached Google; it never offers Undo, only a "View on Google" link, and a
 * failure also persists inline beside the item (OperationOutcomeNotice).
 */
export type ToastKind = "local" | "google"

/** The result types; `loading` is the progress phase (`toastProgress`). */
export type ToastResultType = "success" | "info" | "warning" | "error"

/** Opt-in Undo for a local reversible action. Closes the toast when used. */
export type ToastUndo = {
  onUndo: () => void
  /** Default "Undo". */
  label?: string
}

/** The one trailing item a Google-write toast may carry. */
export type ToastGoogleLink = {
  /** The item on Google (the published reply, the live listing). */
  href: string
}

type OutcomeToastBase = {
  /** Reuse an id to replace a toast in place. */
  id?: string
  title: React.ReactNode
  description?: React.ReactNode
  /** Default "success". */
  type?: ToastResultType
  /** Milliseconds; 0 keeps it until dismissed. Defaults per `withToastDefaults`. */
  timeout?: number
  onClose?: () => void
}

export type LocalToastOptions = OutcomeToastBase & {
  kind?: "local"
  undo?: ToastUndo
  link?: never
}

export type GoogleToastOptions = OutcomeToastBase & {
  kind: "google"
  link?: ToastGoogleLink
  /** A Google write cannot be undone from a toast (D5). */
  undo?: never
}

export type OutcomeToastOptions = LocalToastOptions | GoogleToastOptions

/** What `ToastList` reads from a toast's `data`. */
export type ToastData = {
  kind?: ToastKind
  link?: ToastGoogleLink
}

function readToastData(data: unknown): ToastData {
  if (!data || typeof data !== "object") return {}
  const { kind, link } = data as Record<string, unknown>
  const result: ToastData = {}
  if (kind === "local" || kind === "google") result.kind = kind
  if (
    result.kind === "google" &&
    link &&
    typeof link === "object" &&
    typeof (link as ToastGoogleLink).href === "string"
  ) {
    result.link = { href: (link as ToastGoogleLink).href }
  }
  return result
}

type ManagerUpdateOptions = Exclude<
  Parameters<ReturnType<typeof ToastPrimitive.useToastManager>["update"]>[1],
  (...args: never[]) => unknown
>

/**
 * The part of a toast manager the helpers use: the module-level `toast`, or
 * `useToastManager()` inside a component.
 */
export type ToastManagerLike = {
  add: (options: AddOptions) => string
  update: (id: string, options: ManagerUpdateOptions) => void
  close: (id?: string) => void
}

let toastSequence = 0
function nextToastId() {
  toastSequence += 1
  return `np-toast-${toastSequence}`
}

/**
 * The manager options for an outcome. Always carries a `timeout` key, so an
 * update from the progress phase restarts the auto-dismiss.
 */
function outcomeToManagerOptions(
  options: OutcomeToastOptions,
  id: string,
  manager: ToastManagerLike
): AddOptions & { timeout: number | undefined } {
  const {
    kind = "local",
    undo,
    link,
    title,
    description,
    type,
    onClose,
  } = options
  const data: ToastData =
    kind === "google" && link ? { kind, link: { href: link.href } } : { kind }
  const actionProps =
    kind === "local" && undo
      ? {
          children: undo.label ?? "Undo",
          onClick: () => {
            undo.onUndo()
            manager.close(id)
          },
        }
      : undefined
  // A link, like an action, needs time to be read, decided on and reached.
  const timeout =
    options.timeout ??
    (kind === "google" && link ? ACTION_TOAST_TIMEOUT : undefined)
  const resolved = withToastDefaults({
    title,
    description,
    type: type ?? "success",
    data,
    onClose,
    ...(actionProps ? { actionProps } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
  })
  return { ...resolved, timeout: resolved.timeout }
}

/**
 * Shows a result toast: "Review marked done · Undo" (local, opt-in Undo) or
 * "Reply published · View on Google" (`kind: "google"`, never Undo).
 * Returns the toast's id.
 */
export function showToast(
  options: OutcomeToastOptions,
  manager: ToastManagerLike = toast
): string {
  const id = options.id ?? nextToastId()
  return manager.add({
    ...outcomeToManagerOptions(options, id, manager),
    id,
  })
}

// Not distributive on purpose: only a kind known to be "local" may offer
// Undo. A widened kind (ToastKind) is treated as a Google write (D5).
type ResultOptionsFor<K extends ToastKind> = Omit<
  [K] extends ["local"] ? LocalToastOptions : GoogleToastOptions,
  "kind" | "title" | "id"
>

/** A toast in its progress phase, settled into its result in place. */
export type ToastProgress<K extends ToastKind = "local"> = {
  id: string
  /** The result: same toast, new words, the auto-dismiss starts. */
  success: (title: React.ReactNode, options?: ResultOptionsFor<K>) => void
  /** The failure: same toast, the error's longer timeout. */
  error: (
    title: React.ReactNode,
    options?: Omit<ResultOptionsFor<K>, "type">
  ) => void
  /** New progress words ("Publishing 2 of 5…"). */
  update: (title: React.ReactNode, description?: React.ReactNode) => void
  close: () => void
}

/**
 * Starts a progress toast ("Publishing…", spinner, no auto-dismiss) and
 * returns the handle that turns the SAME toast into its result, as NM does
 * ("Email sending" -> "Email sent · Undo"). The kind is fixed here, so a
 * Google write's result cannot be given an Undo:
 *
 *   const publishing = toastProgress("Publishing…", { kind: "google" })
 *   publishing.success("Reply published", { link: { href } })
 */
export function toastProgress<K extends ToastKind = "local">(
  title: React.ReactNode,
  {
    kind,
    description,
    manager = toast,
  }: {
    kind?: K
    description?: React.ReactNode
    manager?: ToastManagerLike
  } = {}
): ToastProgress<K> {
  const id = nextToastId()
  const resolvedKind: ToastKind = kind ?? "local"
  manager.add({
    id,
    title,
    description,
    type: "loading",
    data: { kind: resolvedKind } satisfies ToastData,
  })
  const settle = (
    resultTitle: React.ReactNode,
    options: ResultOptionsFor<K> | undefined,
    type: ToastResultType
  ) => {
    const outcome = {
      ...options,
      kind: resolvedKind,
      title: resultTitle,
      type,
    } as OutcomeToastOptions
    const resolved = outcomeToManagerOptions(outcome, id, manager)
    manager.update(id, {
      // Clear the progress description unless the result brings its own.
      description: undefined,
      actionProps: undefined,
      ...resolved,
    })
  }
  return {
    id,
    success: (resultTitle, options) =>
      settle(resultTitle, options, options?.type ?? "success"),
    error: (resultTitle, options) =>
      settle(resultTitle, options as ResultOptionsFor<K> | undefined, "error"),
    update: (nextTitle, nextDescription) =>
      manager.update(id, { title: nextTitle, description: nextDescription }),
    close: () => manager.close(id),
  }
}

/**
 * `showToast` and `toastProgress` bound to the nearest Toaster's manager,
 * for components.
 */
function useOutcomeToast() {
  const manager = useToastManager()
  return React.useMemo(
    () => ({
      show: (options: OutcomeToastOptions) => showToast(options, manager),
      progress: <K extends ToastKind = "local">(
        title: React.ReactNode,
        options: { kind?: K; description?: React.ReactNode } = {}
      ) => toastProgress<K>(title, { ...options, manager }),
    }),
    [manager]
  )
}

export {
  Toaster,
  Toast,
  ToastAction,
  ToastClose,
  ToastContent,
  ToastDescription,
  ToastLink,
  ToastPortal,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  createToastManager,
  toast,
  useOutcomeToast,
  useToastManager,
}
