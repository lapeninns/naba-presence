"use client"

import { X } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Filter chips.
 *
 * Two shapes, because they do different jobs and must not look identical:
 * `toggle` is a button that turns a filter on or off and reports state through
 * `aria-pressed`; `removable` shows a filter that is already applied and
 * carries its own labelled remove control.
 *
 * Both are capsules on the fill ladder. A pressed toggle is filled with the
 * accent so the selected filters read at a glance; an applied (removable)
 * filter is tinted, so the two states never look the same. Chips are 28px:
 * the brief's 22px pill metric is for badges, which nobody has to hit.
 */
function ToggleChip({
  pressed,
  className,
  children,
  ...props
}: React.ComponentProps<"button"> & { pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-slot="chip"
      data-pressed={pressed || undefined}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-(--np-radius-pill) px-3 text-ui font-medium whitespace-nowrap focus-halo transition duration-(--np-duration-fast) ease-spring-snappy select-none focus-visible:outline-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0",
        pressed
          ? "bg-primary text-primary-foreground hover:bg-[var(--np-accent-hover)]"
          : "bg-fill text-ink hover:bg-fill-secondary",
        className
      )}
      {...props}
    >
      {children}
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
        "inline-flex h-7 shrink-0 items-center gap-1 rounded-(--np-radius-pill) bg-accent-tint pr-0.5 pl-3 text-ui font-medium whitespace-nowrap text-accent-ink",
        className
      )}
      {...props}
    >
      {children}
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        className="inline-flex size-6 items-center justify-center rounded-(--np-radius-pill) text-accent-ink focus-halo transition duration-(--np-duration-fast) ease-spring-snappy hover:bg-[var(--np-accent-tint-strong)] focus-visible:outline-none active:scale-[0.98]"
      >
        <X className="size-3.5" strokeWidth={1.75} aria-hidden />
      </button>
    </span>
  )
}

export { RemovableChip, ToggleChip }
