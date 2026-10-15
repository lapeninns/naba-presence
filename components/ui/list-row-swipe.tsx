"use client"

import { EllipsisIcon } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

/**
 * The trailing actions of a `ListRow` (`swipeActions`): a left swipe on a
 * touch screen reveals them, and a visible "⋯" button at the end of the row
 * opens the same actions as a menu. The button is the alternative that
 * WCAG 2.5.7 (dragging movements) asks for, and it is how the keyboard and
 * a mouse reach the actions: the swipe is a shortcut, never the only way.
 *
 * - Pointer events, no library. Only touch and pen drag; a mouse uses the
 *   button. The axis locks after `LOCK_DISTANCE` px: a vertical start is
 *   left to the browser (`touch-action: pan-y`), so a list still scrolls.
 * - A row settles open past half the actions' width, else closed. Tapping
 *   the open row, tapping elsewhere, scrolling or pressing Escape closes it,
 *   and only one row is open at a time.
 * - The whole row slides: leading control, hit element, "⋯" button, footer
 *   and details move together over the revealed actions.
 * - The slide is a transition that `prefers-reduced-motion` turns off: the
 *   row snaps.
 * - Closed, the revealed actions are `inert` (and out of the tab order),
 *   so they are never a tab stop behind the row; the "⋯" menu carries the
 *   keyboard path.
 * - Written for a left-to-right page, the app's only direction today: the
 *   actions sit at the end edge and open on a swipe towards the start.
 */

export type ListRowSwipeAction = {
  /** One or two words ("Archive", "Delete"). Shown under the icon. */
  label: string
  icon?: React.ReactNode
  onAction: () => void
  /** `"danger"` draws the danger token and a destructive menu item. */
  tone?: "default" | "danger"
  disabled?: boolean
}

/** One action, or two: a third would not fit a phone's swipe. */
export type ListRowSwipeActions =
  | readonly [ListRowSwipeAction]
  | readonly [ListRowSwipeAction, ListRowSwipeAction]

/** Movement before the gesture picks an axis. */
const LOCK_DISTANCE = 8
/** One action's width when it cannot be measured: `w-20`, 5rem at 16px. */
const FALLBACK_ACTION_WIDTH = 80

/** The row that is open now, so opening another closes it. */
let closeOpenRow: (() => void) | null = null

const TONE_CLASS = {
  default:
    "bg-accent-solid text-ink-on-accent focus-visible:ring-(--np-ink-on-accent)",
  danger:
    "bg-danger-solid text-danger-on-solid focus-visible:ring-(--np-danger-on-solid)",
} as const

type Gesture = {
  id: number
  startX: number
  startY: number
  startOffset: number
  axis: "x" | null
}

function ListRowSwipe({
  actions,
  actionsLabel,
  selected,
  flush,
  control,
  hit,
  below,
}: {
  actions: ListRowSwipeActions
  /** Names the "⋯" button and titles the phone's action sheet. */
  actionsLabel: string
  selected: boolean
  flush: boolean
  /** The leading selection control (absolutely placed in the row). */
  control: React.ReactNode
  /** The row's hit element; the "⋯" button sits beside it. */
  hit: React.ReactNode
  /** The footer and details under the hit element. */
  below: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  /** The live offset while a finger drags; `null` when settled. */
  const [drag, setDrag] = React.useState<number | null>(null)
  const [fullWidth, setFullWidth] = React.useState(
    actions.length * FALLBACK_ACTION_WIDTH
  )
  const surfaceRef = React.useRef<HTMLDivElement>(null)
  const actionsRef = React.useRef<HTMLDivElement>(null)
  const gesture = React.useRef<Gesture | null>(null)
  const lastOffset = React.useRef(0)
  const suppressClick = React.useRef(false)

  React.useLayoutEffect(() => {
    const measured = actionsRef.current?.offsetWidth
    if (measured) setFullWidth(measured)
  }, [actions.length])

  const dismiss = React.useCallback(() => setOpen(false), [])
  const reveal = () => {
    if (closeOpenRow && closeOpenRow !== dismiss) closeOpenRow()
    closeOpenRow = dismiss
    setOpen(true)
  }
  React.useEffect(
    () => () => {
      if (closeOpenRow === dismiss) closeOpenRow = null
    },
    [dismiss]
  )

  // Open: a press elsewhere, a scroll or Escape puts the row back.
  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!surfaceRef.current?.contains(event.target as Node)) dismiss()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss()
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("keydown", onKeyDown)
    window.addEventListener("scroll", dismiss, { capture: true, passive: true })
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("scroll", dismiss, { capture: true })
    }
  }, [open, dismiss])

  const settle = () => {
    const g = gesture.current
    gesture.current = null
    setDrag(null)
    if (g?.axis !== "x") return
    // The click that follows a drag must not open the row.
    // Cleared by the click itself, the next press or the next key.
    suppressClick.current = true
    if (lastOffset.current < -fullWidth / 2) reveal()
    else dismiss()
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" || !event.isPrimary) return
    suppressClick.current = false
    lastOffset.current = open ? -fullWidth : 0
    gesture.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: lastOffset.current,
      axis: null,
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (!g || g.id !== event.pointerId) return
    const dx = event.clientX - g.startX
    const dy = event.clientY - g.startY
    if (g.axis === null) {
      if (Math.hypot(dx, dy) < LOCK_DISTANCE) return
      if (Math.abs(dy) >= Math.abs(dx)) {
        // A vertical start is a scroll: leave it to the browser.
        gesture.current = null
        return
      }
      g.axis = "x"
      event.currentTarget.setPointerCapture?.(event.pointerId)
    }
    lastOffset.current = Math.min(0, Math.max(-fullWidth, g.startOffset + dx))
    setDrag(lastOffset.current)
  }

  const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (gesture.current?.id !== event.pointerId) return
    if (event.type === "pointercancel") gesture.current = null
    settle()
  }

  const onClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    const onRow = (event.target as Element).closest(
      '[data-slot="list-row-hit"]'
    )
    const afterDrag = suppressClick.current
    if (afterDrag || (open && onRow)) {
      // A drag's release, or a tap on the open row: it closes, not opens.
      event.preventDefault()
      event.stopPropagation()
      suppressClick.current = false
      if (!afterDrag) dismiss()
    }
  }

  const offset = drag ?? (open ? -fullWidth : 0)
  const animates = drag === null

  return (
    <div
      ref={surfaceRef}
      data-slot="list-row-swipe"
      data-open={open || undefined}
      style={{ "--swipe-x": `${offset}px` } as React.CSSProperties}
      className="relative flex min-w-0 overflow-hidden"
    >
      <div
        data-slot="list-row-swipe-slide"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={onClickCapture}
        onKeyDownCapture={() => {
          suppressClick.current = false
        }}
        className={cn(
          "relative flex min-w-0 flex-1 translate-x-(--swipe-x) touch-pan-y flex-col",
          animates &&
            "transition-transform duration-(--np-duration-fast) ease-spring-snappy motion-reduce:transition-none"
        )}
      >
        {control}
        <div
          data-slot="list-row-swipe-main"
          className={cn(
            "flex min-w-0 items-center",
            // Room for the button's 44px overhang (it is 36px drawn): the
            // surface clips whatever passes the end edge.
            flush ? "pe-1" : "pe-[calc(var(--np-page-pad-x)-(--spacing(3)))]",
            selected && "bg-fill"
          )}
        >
          {hit}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={actionsLabel}
                  data-slot="list-row-actions-trigger"
                  className="shrink-0 text-ink-muted"
                />
              }
            >
              <EllipsisIcon aria-hidden strokeWidth={1.75} />
            </DropdownMenuTrigger>
            <DropdownMenuContent title={actionsLabel}>
              {actions.map((action, index) => (
                <DropdownMenuItem
                  key={`${index}-${action.label}`}
                  variant={action.tone === "danger" ? "destructive" : "default"}
                  disabled={action.disabled}
                  onClick={action.onAction}
                >
                  {action.icon}
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {below}
      </div>
      <div
        data-slot="list-row-swipe-actions"
        inert={offset === 0 ? true : undefined}
        className={cn(
          "absolute inset-y-0 end-0 flex w-[calc(var(--swipe-x)*-1)] justify-end overflow-hidden",
          animates &&
            "transition-[width] duration-(--np-duration-fast) ease-spring-snappy motion-reduce:transition-none"
        )}
      >
        <div ref={actionsRef} className="flex shrink-0">
          {actions.map((action, index) => (
            <button
              key={`${index}-${action.label}`}
              type="button"
              disabled={action.disabled}
              tabIndex={offset === 0 ? -1 : undefined}
              data-slot="list-row-swipe-action"
              data-tone={action.tone ?? "default"}
              onClick={() => {
                dismiss()
                action.onAction()
              }}
              className={cn(
                "flex w-20 shrink-0 flex-col items-center justify-center gap-1 px-2 text-center text-caption font-semibold wrap-anywhere outline-none focus-visible:ring-2 focus-visible:ring-inset disabled:opacity-50 [&_svg]:size-5 [&_svg]:shrink-0",
                TONE_CLASS[action.tone ?? "default"]
              )}
            >
              {action.icon}
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export { ListRowSwipe }
