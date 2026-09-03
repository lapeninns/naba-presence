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
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-(--np-radius-pill) border px-2.5 text-ui font-medium transition-colors duration-(--np-duration-fast) focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
        pressed
          ? "border-transparent bg-accent-tint text-accent-ink"
          : "border-line bg-surface text-ink-muted hover:text-ink",
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
        "inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-(--np-radius-pill) border border-transparent bg-accent-tint pr-1 pl-2.5 text-ui font-medium text-accent-ink",
        className
      )}
      {...props}
    >
      {children}
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        className="inline-flex size-5 items-center justify-center rounded-full transition-colors duration-(--np-duration-fast) hover:bg-[var(--np-hover-bg)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <X className="size-3" aria-hidden />
      </button>
    </span>
  )
}

export { RemovableChip, ToggleChip }
