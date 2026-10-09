"use client"

import { X } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Filter and queue chips (reference `.chip`).
 *
 * A 32px capsule (40px on coarse pointers) on the surface with a hairline
 * edge. Pressed (or `aria-current="page"` on a link chip) fills with INK, not
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
    "group/chip inline-flex h-8 shrink-0 items-center gap-1.5 rounded-(--np-radius-pill) border border-line bg-surface px-3 text-ui font-medium whitespace-nowrap text-ink no-underline focus-halo transition-[background-color,border-color,color] duration-(--np-duration-fast) ease-spring-snappy select-none focus-visible:outline-none pointer-coarse:h-10",
    "hover:border-line-strong hover:bg-surface-alt",
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0",
    "aria-[current=page]:border-ink aria-[current=page]:bg-ink aria-[current=page]:text-canvas",
    pressed && "border-ink bg-ink text-canvas hover:border-ink hover:bg-ink",
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
        "font-mono text-[11.5px] leading-none tabular-nums",
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
        "pr-1 hover:border-line hover:bg-surface",
        className
      )}
      {...props}
    >
      {children}
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        className="relative inline-grid size-5 place-items-center rounded-(--np-radius-pill) text-ink-muted focus-halo transition-colors duration-(--np-duration-fast) ease-spring-snappy after:absolute after:-inset-1.5 after:content-[''] hover:bg-fill hover:text-ink focus-visible:outline-none"
      >
        <X className="size-3.5" strokeWidth={1.75} aria-hidden />
      </button>
    </span>
  )
}

/**
 * A single row of chips that scrolls sideways rather than wrapping. A chip
 * cut by the edge tells the reader there is more; keyboard users reach every
 * chip by Tab, and the scroll follows focus.
 */
function ChipRow({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="chip-row"
      className={cn(
        "-m-0.5 flex min-w-0 [scrollbar-width:none] gap-2 overflow-x-auto p-0.5 [&::-webkit-scrollbar]:hidden",
        className
      )}
      {...props}
    />
  )
}

export { ChipCount, ChipRow, RemovableChip, ToggleChip, chipClassName }
