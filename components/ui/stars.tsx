import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Reference `.stars`: five filled 14px stars in the rating colour, the unlit
 * ones in the hairline grey. One image with a spoken label ("4 out of 5
 * stars"); the glyphs themselves are ornament.
 *
 * Props: `value` (0–5, rounded to the nearest whole star; `null` renders
 * `emptyLabel`, "No rating", in words), `max` (default 5), `size` ("sm"
 * 12px, default 14px, "lg" 18px), and `label`, the spoken text: a string, or
 * a function of the value for a list that names its rows by the rating
 * ("4 stars", the inbox's wording):
 *
 *   <Stars value={4} label={(value) => `${value} star${value === 1 ? "" : "s"}`} />
 */
const STAR_SIZE = { sm: "size-3", default: "size-3.5", lg: "size-4.5" }

function StarGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path
        fill="currentColor"
        d="M12 2.5l2.95 5.98 6.6.96-4.78 4.65 1.13 6.57L12 17.56l-5.9 3.1 1.13-6.57L2.45 9.44l6.6-.96L12 2.5z"
      />
    </svg>
  )
}

function Stars({
  value,
  max = 5,
  size = "default",
  label,
  emptyLabel,
  className,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & {
  value: number | null
  max?: number
  size?: keyof typeof STAR_SIZE
  label?: string | ((value: number, max: number) => string)
  /** The words shown when there is no rating. */
  emptyLabel?: string
}) {
  if (value === null || Number.isNaN(value)) {
    return (
      <span
        data-slot="stars"
        className={cn("text-caption text-ink-muted", className)}
        {...props}
      >
        {/* A string label predates `emptyLabel` and still names the empty
            state for the callers that relied on it. */}
        {emptyLabel ?? (typeof label === "string" ? label : "No rating")}
      </span>
    )
  }
  const lit = Math.max(0, Math.min(max, Math.round(value)))
  return (
    <span
      role="img"
      data-slot="stars"
      aria-label={
        typeof label === "function"
          ? label(value, max)
          : (label ?? `${value} out of ${max} stars`)
      }
      className={cn("inline-flex shrink-0 gap-px text-rating", className)}
      {...props}
    >
      {Array.from({ length: max }, (_, index) => (
        <StarGlyph
          key={index}
          className={cn(STAR_SIZE[size], index >= lit && "text-line")}
        />
      ))}
    </span>
  )
}

export { Stars }
