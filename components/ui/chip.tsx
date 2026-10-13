"use client"

import { X } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A count beside a chip label: `text-count` in the sans with tabular
 * figures (D1: mono is for IDs, codes and table figures only), so a
 * changing count does not shift its neighbours.
 */
const CHIP_COUNT_CLASS = "text-count leading-none tabular-nums"

/** The danger ink for a count that needs attention; paired with its label. */
const ALERT_COUNT_CLASS = "font-semibold text-danger-ink"

/**
 * Filter and queue chips (reference `.chip`): a CONTROL. A chip is pressed
 * (a filter, a queue) or removed (an applied filter). A state word belongs in
 * a `StatusPill`, a count or category in a `Badge`; the full rule is in
 * status-pill.tsx.
 *
 * A capsule `--np-control-h-sm` tall (36px on touch, 30px on a desk) on the
 * surface with a hairline edge. On touch an invisible extension takes the
 * hit area to the 44px floor without making a row of chips 44px tall; a desk
 * pointer does not need it. Pressed (or `aria-current="page"` on a link chip) fills with INK, not
 * the accent: the accent is reserved for the primary action and the current
 * nav item. Counts are sans with tabular figures; `countTone="alert"` draws
 * a count that needs attention in the danger ink.
 *
 * `ToggleChip` is a button reporting `aria-pressed`. `RemovableChip` shows a
 * filter that is applied and carries a labelled remove control. For a chip
 * that is a link (queue tabs), apply `chipClassName()` to the anchor and
 * put a `<ChipCount>` inside. `ChipRow` is the horizontally scrolling row.
 */
function chipClassName({
  pressed = false,
  className,
}: { pressed?: boolean; className?: string } = {}) {
  return cn(
    "group/chip relative inline-flex h-(--np-control-h-sm) shrink-0 items-center gap-1.5 rounded-(--np-radius-pill) border border-line bg-surface px-3 text-ui font-medium whitespace-nowrap text-ink no-underline focus-halo transition-[background-color,border-color,color] duration-(--np-duration-fast) ease-spring-snappy select-none focus-visible:outline-none",
    // The touch hit area: 36px drawn, 44px pressable. A percentage inset
    // resolves against the padding box, so the 1px border can't shave it
    // (a fixed -4px gave 34 + 8 = 42px).
    "after:absolute after:inset-x-0 after:inset-y-[calc((100%-var(--np-touch))/2)] after:content-[''] desk:after:hidden",
    "hover-fine:hover:border-line-strong hover-fine:hover:bg-surface-alt",
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0",
    "aria-[current=page]:border-ink aria-[current=page]:bg-ink aria-[current=page]:text-canvas",
    pressed &&
      "border-ink bg-ink text-canvas hover-fine:hover:border-ink hover-fine:hover:bg-ink",
    className
  )
}

/** A count inside a chip, segment or tab (sans, tabular figures). */
function ChipCount({
  tone = "default",
  className,
  ...props
}: React.ComponentProps<"span"> & { tone?: "default" | "alert" }) {
  return (
    <span
      data-slot="chip-count"
      data-tone={tone}
      className={cn(
        CHIP_COUNT_CLASS,
        tone === "alert"
          ? ALERT_COUNT_CLASS
          : "text-ink-muted group-aria-pressed/chip:text-canvas/80 group-aria-[current=page]/chip:text-canvas/80",
        className
      )}
      {...props}
    />
  )
}

function ToggleChip({
  pressed,
  count,
  countTone,
  className,
  children,
  ...props
}: React.ComponentProps<"button"> & {
  pressed?: boolean
  /** A count after the label (sans, tabular figures). */
  count?: React.ReactNode
  countTone?: "default" | "alert"
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-slot="chip"
      data-pressed={pressed || undefined}
      className={chipClassName({ pressed, className })}
      {...props}
    >
      {children}
      {count !== undefined && count !== null ? (
        <ChipCount tone={countTone}>{count}</ChipCount>
      ) : null}
    </button>
  )
}

function RemovableChip({
  onRemove,
  removeLabel,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & {
  onRemove: () => void
  /** Names the specific filter, e.g. "Remove rating filter". */
  removeLabel: string
  children: React.ReactNode
}) {
  return (
    <span
      data-slot="chip"
      className={cn(
        chipClassName(),
        // The remove button carries its own 44px target, so the chip's
        // extension would only cover it.
        "pr-1 after:hidden hover-fine:hover:border-line hover-fine:hover:bg-surface",
        className
      )}
      {...props}
    >
      {children}
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        // 28px drawn on touch with a 44px target (`-inset-2`); 20px with a
        // 32px target on a desk.
        className="relative inline-grid size-7 place-items-center rounded-(--np-radius-pill) text-ink-muted focus-halo transition-colors duration-(--np-duration-fast) ease-spring-snappy after:absolute after:-inset-2 after:content-[''] focus-visible:outline-none hover-fine:hover:bg-fill hover-fine:hover:text-ink desk:size-5 desk:after:-inset-1.5"
      >
        <X className="size-3.5" strokeWidth={1.75} aria-hidden />
      </button>
    </span>
  )
}

/**
 * A single row of chips that scrolls sideways rather than wrapping, so no
 * label is ever truncated. Keyboard users reach every chip by Tab, and the
 * scroll follows focus.
 *
 * Two behaviours a phone needs (both JS, neither chooses a layout, so the
 * server HTML is the same):
 * - the edge with chips hidden past it fades out (`data-fade`, a CSS mask),
 *   so the row says there is more without drawing a scrollbar;
 * - the pressed or current chip is scrolled into view when it changes, so a
 *   filter chosen elsewhere (a URL, a reset) is never off-screen.
 *
 * The vertical padding leaves room for the 44px touch extension and the
 * focus halo, which a scrolling box would otherwise clip.
 */
function ChipRow({
  className,
  ref: forwardedRef,
  ...props
}: React.ComponentProps<"div">) {
  const ref = React.useRef<HTMLDivElement>(null)
  const current = React.useRef<Element | null>(null)
  // A caller's ref (React 19 passes it as a prop) must not replace the
  // row's own: the fade and the reveal below both read it.
  const setRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      ref.current = node
      if (typeof forwardedRef === "function") forwardedRef(node)
      else if (forwardedRef) forwardedRef.current = node
    },
    [forwardedRef]
  )

  React.useEffect(() => {
    const row = ref.current
    if (!row) return
    const update = () => {
      const max = row.scrollWidth - row.clientWidth
      const start = row.scrollLeft > 1
      const end = max - row.scrollLeft > 1
      const fade = start && end ? "both" : start ? "start" : end ? "end" : ""
      if (fade) row.dataset.fade = fade
      else delete row.dataset.fade
    }
    update()
    row.addEventListener("scroll", update, { passive: true })
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update)
    observer?.observe(row)
    return () => {
      row.removeEventListener("scroll", update)
      observer?.disconnect()
    }
  }, [])

  // After every render: if the pressed/current chip changed, bring it into
  // view. Only on change, so a reader's own sideways scroll is never undone.
  // The ROW scrolls sideways, never the page: `scrollIntoView` (even with
  // `block: "nearest"`) would also scroll every ancestor vertically, so a
  // filter row below the fold (or under the app bar) would jump the page on
  // load. A change after mount glides unless the reader asked for reduced
  // motion; the first placement is always instant.
  React.useEffect(() => {
    const row = ref.current
    if (!row) return
    const active = row.querySelector(
      '[aria-pressed="true"], [aria-current="page"]'
    )
    if (active && active !== current.current) {
      const port = row.getBoundingClientRect()
      const chip = active.getBoundingClientRect()
      // A chip's width of breathing room past the faded edge.
      const margin = Math.min(chip.width, port.width / 4)
      const delta =
        chip.left < port.left
          ? chip.left - port.left - margin
          : chip.right > port.right
            ? chip.right - port.right + margin
            : 0
      if (delta !== 0) {
        const glide =
          current.current !== null &&
          typeof row.scrollTo === "function" &&
          typeof window.matchMedia === "function" &&
          window.matchMedia("(prefers-reduced-motion: no-preference)").matches
        if (glide)
          row.scrollTo({ left: row.scrollLeft + delta, behavior: "smooth" })
        else row.scrollLeft += delta
      }
    }
    current.current = active
  })

  return (
    <div
      ref={setRef}
      data-slot="chip-row"
      className={cn(
        "-mx-0.5 -my-1.5 flex min-w-0 [scrollbar-width:none] gap-2 overflow-x-auto px-0.5 py-1.5 [&::-webkit-scrollbar]:hidden",
        "data-[fade=end]:[mask-image:linear-gradient(to_right,#000_calc(100%-2.5rem),transparent)]",
        "data-[fade=start]:[mask-image:linear-gradient(to_left,#000_calc(100%-2.5rem),transparent)]",
        "data-[fade=both]:[mask-image:linear-gradient(to_right,transparent,#000_2.5rem,#000_calc(100%-2.5rem),transparent)]",
        className
      )}
      {...props}
    />
  )
}

/** The plain text of a label, for the remove control's name. */
function labelText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean")
    return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(labelText).join("")
  if (React.isValidElement<{ children?: React.ReactNode }>(node))
    return labelText(node.props.children)
  return ""
}

/**
 * The filter chip (Notion Mail, brief §4.3): a quieter capsule than
 * `ToggleChip`, `--np-chip-h` drawn (28px touch, 24px desk) on the
 * `fill-secondary` grey with no edge, `text-ui`. On touch an invisible
 * extension takes the hit area to the 44px floor, so a strip of chips stays
 * short.
 *
 * Two jobs, by props:
 * - a TOGGLE (`pressed`, `onClick`): a button reporting `aria-pressed`;
 * - an APPLIED filter (`onRemove`): the whole chip is the remove control,
 *   drawn with a ×, named "Remove filter: <label>" (`removeLabel`
 *   overrides). A 20px × inside a 28px chip is too small to hit on a phone,
 *   and an applied chip has nothing else to do when pressed.
 *
 * Pressed and applied chips are `accent-tint` / `accent-ink` / 600: the
 * weight and the × (or the pressed state) are the non-colour cues.
 * Labels are never truncated: put chips in a `FilterChipStrip`, which
 * scrolls sideways instead.
 */
function filterChipClassName({
  active = false,
  className,
}: { active?: boolean; className?: string } = {}) {
  return cn(
    "group/chip relative inline-flex h-(--np-chip-h) shrink-0 items-center gap-1 rounded-(--np-radius-pill) bg-fill-secondary px-3 text-ui whitespace-nowrap text-ink no-underline focus-halo transition-[background-color,color] duration-(--np-duration-fast) ease-spring-snappy select-none focus-visible:outline-none",
    // 28px drawn, 44px pressable on touch (see chipClassName).
    "after:absolute after:inset-x-0 after:inset-y-[calc((100%-var(--np-touch))/2)] after:content-[''] desk:after:hidden",
    "hover-fine:hover:bg-fill",
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0",
    active &&
      "bg-accent-tint font-semibold text-accent-ink hover-fine:hover:bg-(--np-accent-tint-strong)",
    className
  )
}

type FilterChipProps = Omit<React.ComponentProps<"button">, "children"> & {
  children: React.ReactNode
  /** A toggle chip's state; reported as `aria-pressed`. */
  pressed?: boolean
  /** Makes the chip an applied filter whose press removes it. */
  onRemove?: () => void
  /** The remove control's name. Defaults to "Remove filter: <label>". */
  removeLabel?: string
  /** A count after the label (sans, tabular figures). */
  count?: React.ReactNode
  /**
   * `alert` draws the count in the danger ink (a bucket that needs
   * attention). The label still says what it counts: colour only
   * reinforces it.
   */
  countTone?: "default" | "alert"
}

function FilterChip({
  children,
  pressed,
  onRemove,
  removeLabel,
  count,
  countTone = "default",
  className,
  onClick,
  ...props
}: FilterChipProps) {
  const removable = onRemove !== undefined
  const active = removable || Boolean(pressed)
  return (
    <button
      type="button"
      data-slot="filter-chip"
      data-active={active || undefined}
      aria-pressed={removable ? undefined : pressed}
      aria-label={
        removable
          ? (removeLabel ?? `Remove filter: ${labelText(children)}`)
          : undefined
      }
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) onRemove?.()
      }}
      className={filterChipClassName({
        active,
        className: cn(removable && "pe-2", className),
      })}
      {...props}
    >
      {children}
      {count !== undefined && count !== null ? (
        <>
          {/* A real space, so the name reads "Needs attention 2"; the flex
              row drops it from the drawing and `gap` spaces it. */}{" "}
          <span
            data-slot="chip-count"
            data-tone={countTone}
            className={cn(
              CHIP_COUNT_CLASS,
              countTone === "alert" && ALERT_COUNT_CLASS
            )}
          >
            {count}
          </span>
        </>
      ) : null}
      {removable ? <X aria-hidden strokeWidth={1.75} /> : null}
    </button>
  )
}

const STRIP_FOCUSABLE =
  "button:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])"

/**
 * The strip filter chips sit in: one row that scrolls sideways (never
 * wraps, never truncates) with faded edges, and the pressed or current chip
 * kept in view (see `ChipRow`, which owns both).
 *
 * Focus is never dropped on the page: when the focused chip leaves the
 * strip (an applied filter removed, by its own press or by a URL change),
 * focus moves to the chip that took its place (the next one), else the
 * previous one. When none is left, `onEmpty` is called so the caller can
 * move focus somewhere meaningful (the search field, the Filters button);
 * without it, the strip itself takes focus while it is still on screen.
 */
function FilterChipStrip({
  className,
  onEmpty,
  ref: forwardedRef,
  ...props
}: React.ComponentProps<"div"> & {
  /** Called when the last chip is removed while one had focus. */
  onEmpty?: () => void
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const onEmptyRef = React.useRef(onEmpty)
  React.useEffect(() => {
    onEmptyRef.current = onEmpty
  })
  const setRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      ref.current = node
      if (typeof forwardedRef === "function") forwardedRef(node)
      else if (forwardedRef) forwardedRef.current = node
    },
    [forwardedRef]
  )

  React.useEffect(() => {
    const strip = ref.current
    if (!strip) return
    // The chip that had focus, and where it stood among the strip's stops.
    let last: { element: HTMLElement; index: number } | null = null
    const items = () =>
      Array.from(strip.querySelectorAll<HTMLElement>(STRIP_FOCUSABLE))
    const focusLost = () => {
      const active = document.activeElement
      return active === null || active === document.body
    }

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement
      const index = items().indexOf(target)
      last = index === -1 ? null : { element: target, index }
    }
    const onFocusOut = (event: FocusEvent) => {
      // Focus went somewhere else on purpose: forget the chip.
      const next = event.relatedTarget as Node | null
      if (next && !strip.contains(next)) last = null
    }
    const restore = () => {
      if (!last || last.element.isConnected || !focusLost()) return
      const remaining = items()
      const target = remaining[last.index] ?? remaining[last.index - 1] ?? null
      last = null
      if (target) target.focus()
      else if (onEmptyRef.current) onEmptyRef.current()
      else {
        strip.tabIndex = -1
        strip.focus()
      }
    }

    strip.addEventListener("focusin", onFocusIn)
    strip.addEventListener("focusout", onFocusOut)
    const observer =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(restore)
    observer?.observe(strip, { childList: true, subtree: true })
    return () => {
      strip.removeEventListener("focusin", onFocusIn)
      strip.removeEventListener("focusout", onFocusOut)
      observer?.disconnect()
      // The strip itself went away with the last chip (a toolbar that only
      // shows chips while there are some): hand focus to the caller.
      const pending = last
      if (pending && !pending.element.isConnected && !strip.isConnected)
        queueMicrotask(() => {
          if (focusLost()) onEmptyRef.current?.()
        })
    }
  }, [])

  return (
    <ChipRow
      ref={setRef}
      data-slot="filter-chip-strip"
      // The 28px chip reaches 44px on touch; the padding keeps that hit
      // area from being clipped by the scrolling row. A strip that took
      // focus (no chips left, no `onEmpty`) shows no ring of its own.
      className={cn("-my-2 gap-1.5 py-2 outline-none", className)}
      {...props}
    />
  )
}

export {
  ChipCount,
  ChipRow,
  FilterChip,
  FilterChipStrip,
  RemovableChip,
  ToggleChip,
  chipClassName,
  filterChipClassName,
}
export type { FilterChipProps }
