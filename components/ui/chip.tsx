"use client"

import { X } from "lucide-react"
import * as React from "react"

import { isZeroCount } from "@/components/ui/count-text"
import { cn } from "@/lib/utils"

/**
 * A count beside a chip label: `text-count` in the sans with tabular
 * figures (D1: mono is for IDs, codes and table figures only), so a
 * changing count does not shift its neighbours.
 */
const CHIP_COUNT_CLASS = "text-count leading-none tabular-nums"

/**
 * The danger ink for a count that needs attention; paired with its label.
 * Only while the chip is unpressed: on a pressed or applied chip's ink fill
 * (`data-active` on the `group/chip`) the danger ink does not read, so the
 * count takes the chip's own `ink-inverse` and the label still says what it
 * counts.
 */
const ALERT_COUNT_CLASS =
  "font-semibold text-danger-ink group-data-active/chip:text-ink-inverse"

/**
 * In a pressed or applied chip the count drops to 400 under the 500 label,
 * so the figure stays one step quieter without fading (no opacity on text).
 * Its colour is inherited from the chip.
 */
const PRESSED_COUNT_CLASS = "group-data-active/chip:font-normal"

/**
 * A count inside a chip, segment or tab (sans, tabular figures), in the
 * ink of the control it sits in (so a pressed chip's count stays legible).
 * A zero draws nothing (see `isZeroCount`): one rule for every strip.
 */
function ChipCount({
  tone = "default",
  className,
  ...props
}: React.ComponentProps<"span"> & { tone?: "default" | "alert" }) {
  if (isZeroCount(props.children)) return null
  return (
    <span
      data-slot="chip-count"
      data-tone={tone}
      className={cn(
        CHIP_COUNT_CLASS,
        tone === "alert" && ALERT_COUNT_CLASS,
        PRESSED_COUNT_CLASS,
        className
      )}
      {...props}
    />
  )
}

/**
 * A tag the reader can take away (a category on a profile): the filter
 * chip's capsule with its own labelled remove control. For an APPLIED
 * FILTER use `FilterChip onRemove`, where the whole chip is the control.
 */
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
        filterChipClassName(),
        // The remove button carries its own 44px target, so the chip's
        // extension would only cover it. The capsule itself is inert: no
        // hover fill and no press scale (its button gives the feedback).
        "pe-1 after:hidden motion-safe:active:scale-100 hover-fine:hover:bg-fill-secondary",
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
 * The vertical padding (`py-2`, 8px) leaves room for the 44px touch
 * extension of the 28px chip (8px above and below), which a scrolling box
 * would otherwise clip to a shorter target, and for the focus halo. The
 * negative margin gives the space back, so the row keeps its drawn height.
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
        "-mx-0.5 -my-2 flex min-w-0 [scrollbar-width:none] gap-2 overflow-x-auto px-0.5 py-2 [&::-webkit-scrollbar]:hidden",
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
 * THE filter chip (Notion Mail, brief §4.3): one primitive and one pressed
 * style for every strip of filters and queues (inbox, listings, clients).
 * `--np-chip-h` drawn (28px touch, 24px desk) on the `fill-secondary` grey
 * with no edge, `text-ui`. On touch an invisible extension takes the hit
 * area to the 44px floor, so a strip of chips stays short.
 *
 * Two jobs, by props:
 * - a TOGGLE (`pressed`, `onClick`): a button reporting `aria-pressed`;
 * - an APPLIED filter (`onRemove`): the whole chip is the remove control,
 *   drawn with a ×, named "Remove filter: <label>" (`removeLabel`
 *   overrides). A 20px × inside a 28px chip is too small to hit on a phone,
 *   and an applied chip has nothing else to do when pressed.
 *
 * Pressed and applied chips are INK (`ink` fill, `ink-inverse` label, 500):
 * chrome is ink, and the accent is kept for the action, focus and the
 * current place. The fill is a lightness jump in both themes (near-black
 * on light, near-white on dark), so it does not lean on hue, and the
 * weight and the × (or `aria-pressed`) are the cues that do not depend on
 * colour at all. There is no second, accent-tinted pressed style.
 *
 * Unpressed chips rest on `fill-secondary`, go one step to `fill` under a
 * fine pointer, and every chip sinks slightly (`scale-[0.97]`) while it is
 * pressed, in 140ms on scale and colour only (Tailwind 4's `scale-*` sets
 * the `scale` property, not `transform`); reduced motion keeps the colour
 * change and drops the scale. Disabled is drawn with the disabled
 * roles, never faded.
 *
 * A count follows the zero rule (`isZeroCount`): zero draws no figure. A
 * strip of buckets can also pass `hideWhenZero` to drop an empty bucket
 * altogether, unless it is the one selected, so a chosen filter never
 * vanishes from under the reader.
 *
 * Labels are never truncated: put chips in a `FilterChipStrip`, which
 * scrolls sideways (or wraps, with `md:flex-wrap`) instead.
 */
function filterChipClassName({
  active = false,
  className,
}: { active?: boolean; className?: string } = {}) {
  return cn(
    "group/chip relative inline-flex h-(--np-chip-h) shrink-0 items-center gap-1 rounded-(--np-radius-pill) bg-fill-secondary px-3 text-ui whitespace-nowrap text-ink no-underline focus-halo transition-[background-color,color,scale] duration-(--np-duration-fast) ease-spring-snappy select-none focus-visible:outline-none motion-safe:active:scale-[0.97]",
    // 28px drawn, 44px pressable on touch.
    "after:absolute after:inset-x-0 after:inset-y-[calc((100%-var(--np-touch))/2)] after:content-[''] desk:after:hidden",
    "hover-fine:hover:bg-fill",
    // Drawn, not faded: the sunken fill with the muted label (4.5:1, gated).
    "disabled:pointer-events-none disabled:bg-disabled disabled:text-disabled-ink [&_svg]:size-3.5 [&_svg]:shrink-0",
    // Pressed or applied: the ink fill with the inverse label at 500. A
    // hover does not lighten it (the unpressed hover fill would otherwise
    // win): the press scale is its feedback. In dark the ink fill is
    // near-white, where the rating amber falls to about 1.4:1, so a pressed
    // chip remaps the rating role to its own label ink: a rating star
    // (`fill-(--np-rating)`) stays visible without the caller changing, and
    // icons drawn in any other colour are left alone.
    active &&
      "bg-ink font-medium text-ink-inverse dark:[--np-rating:var(--np-ink-inverse)] hover-fine:hover:bg-ink",
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
  /** A count after the label (sans, tabular figures). Zero draws no figure. */
  count?: React.ReactNode
  /**
   * Opt-in: draw nothing at all while `count` is zero, unless the chip is
   * pressed or applied (a selected bucket never disappears).
   */
  hideWhenZero?: boolean
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
  hideWhenZero = false,
  countTone = "default",
  className,
  onClick,
  ...props
}: FilterChipProps) {
  const removable = onRemove !== undefined
  const active = removable || Boolean(pressed)
  const hasCount = count !== undefined && count !== null
  const zero = hasCount && isZeroCount(count)
  if (hideWhenZero && zero && !active) return null
  return (
    <button
      type="button"
      data-slot="filter-chip"
      data-active={active || undefined}
      aria-pressed={removable ? undefined : pressed}
      aria-label={
        removable
          ? (removeLabel ?? `Remove filter: ${labelText(children)}`)
          : zero
            ? // A zero draws no figure, but the name still says it: "In sync, 0".
              `${labelText(children)}, 0`
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
      {hasCount && !zero ? (
        <>
          {/* A real space, so the name reads "Needs attention 2"; the flex
              row drops it from the drawing and `gap` spaces it. */}{" "}
          <ChipCount tone={countTone}>{count}</ChipCount>
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
      className={cn("gap-1.5 outline-none", className)}
      {...props}
    />
  )
}

/**
 * A read-only token (a selected listing, a recipient): the filter chip's
 * capsule (`--np-chip-h` at least, `fill-secondary`, `text-ui`) with no control in
 * it, so it is not a tab stop and has no hover. For a token the reader can
 * remove, use `RemovableChip` or an applied `FilterChip`.
 */
function TokenChip({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="token-chip"
      className={cn(
        // A long name wraps inside the capsule rather than being clipped.
        "inline-flex min-h-(--np-chip-h) max-w-full min-w-0 items-center gap-1 rounded-(--np-radius-pill) bg-fill-secondary px-3 py-0.5 text-ui [overflow-wrap:anywhere] text-ink [&_svg]:size-3.5 [&_svg]:shrink-0",
        className
      )}
      {...props}
    />
  )
}

export type TokenChipItem = { id: React.Key; label: React.ReactNode }

/**
 * A wrapping list of read-only tokens that shows the first `max` and then
 * "+N more" ("Selected listings: The Bell, The Crown, +3 more").
 *
 * Nothing is hidden from assistive technology: the tokens past `max` are
 * still in the list as visually hidden items, and the "+N more" text is
 * `aria-hidden`, so a screen reader reads every token once and the list's
 * item count is the true count. Name the list with `aria-label` or
 * `aria-labelledby`.
 */
function TokenChipList({
  items,
  max = 3,
  moreLabel = (hidden) => `+${hidden} more`,
  className,
  ...props
}: Omit<React.ComponentProps<"ul">, "children"> & {
  items: readonly TokenChipItem[]
  /** How many tokens to draw before "+N more" (default 3). */
  max?: number
  /** The overflow text for `hidden` more tokens. Default "+N more". */
  moreLabel?: (hidden: number) => React.ReactNode
}) {
  const shown = Math.max(0, max)
  const hidden = Math.max(0, items.length - shown)
  return (
    <ul
      role="list"
      data-slot="token-chip-list"
      className={cn(
        "flex min-w-0 list-none flex-wrap items-center gap-1.5",
        className
      )}
      {...props}
    >
      {items.map((item, index) => (
        <li
          key={item.id}
          data-hidden-token={index >= shown || undefined}
          className={cn("flex max-w-full min-w-0", index >= shown && "sr-only")}
        >
          <TokenChip>{item.label}</TokenChip>
        </li>
      ))}
      {hidden > 0 ? (
        <li
          aria-hidden="true"
          data-slot="token-chip-more"
          className="flex text-ui whitespace-nowrap text-ink-muted"
        >
          {moreLabel(hidden)}
        </li>
      ) : null}
    </ul>
  )
}

export {
  ChipCount,
  ChipRow,
  FilterChip,
  FilterChipStrip,
  RemovableChip,
  TokenChip,
  TokenChipList,
  filterChipClassName,
}
export type { FilterChipProps }
