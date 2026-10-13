"use client"

import { X } from "lucide-react"
import * as React from "react"

import { COUNT_TEXT_CLASS } from "@/components/ui/count-text"
import { cn } from "@/lib/utils"

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
 * nav item. Counts are mono; `countTone="alert"` draws a count that needs
 * attention in the danger ink.
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
    // The touch hit area: 36px drawn, 44px pressable.
    "after:absolute after:inset-x-0 after:-inset-y-1 after:content-[''] desk:after:hidden",
    "hover-fine:hover:border-line-strong hover-fine:hover:bg-surface-alt",
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0",
    "aria-[current=page]:border-ink aria-[current=page]:bg-ink aria-[current=page]:text-canvas",
    pressed &&
      "border-ink bg-ink text-canvas hover-fine:hover:border-ink hover-fine:hover:bg-ink",
    className
  )
}

/** A mono count inside a chip, segment or tab. */
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
        COUNT_TEXT_CLASS,
        tone === "alert"
          ? "font-bold text-danger-ink"
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
  /** A count after the label, in mono. */
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
        className="relative inline-grid size-7 place-items-center rounded-(--np-radius-pill) text-ink-muted focus-halo transition-colors duration-(--np-duration-fast) ease-spring-snappy after:absolute after:-inset-2 after:content-[''] hover-fine:hover:bg-fill hover-fine:hover:text-ink focus-visible:outline-none desk:size-5 desk:after:-inset-1.5"
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
function ChipRow({ className, ...props }: React.ComponentProps<"div">) {
  const ref = React.useRef<HTMLDivElement>(null)
  const current = React.useRef<Element | null>(null)

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
  React.useEffect(() => {
    const row = ref.current
    if (!row) return
    const active = row.querySelector(
      '[aria-pressed="true"], [aria-current="page"]'
    )
    if (active && active !== current.current) {
      active.scrollIntoView?.({ block: "nearest", inline: "nearest" })
    }
    current.current = active
  })

  return (
    <div
      ref={ref}
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

export { ChipCount, ChipRow, RemovableChip, ToggleChip, chipClassName }
