import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Reference `.stars`: five filled 14px stars in the rating colour, the unlit
 * ones in the hairline grey. One image with a spoken label ("4 out of 5
 * stars"); the glyphs themselves are ornament.
 *
 * Props: `value` (0–5, rounded to the nearest whole star; `null` renders
 * "No rating" in words), `max` (default 5), `size` ("sm" 12px, default 14px,
 * "lg" 18px), `label` to override the spoken text.
 */
const STAR_SIZE = { sm: "size-3", default: "size-3.5", lg: "size-[18px]" }

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
  className,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & {
  value: number | null
  max?: number
  size?: keyof typeof STAR_SIZE
  label?: string
}) {
  if (value === null || Number.isNaN(value)) {
    return (
      <span
        data-slot="stars"
        className={cn("text-caption text-ink-muted", className)}
        {...props}
      >
        {label ?? "No rating"}
      </span>
    )
  }
  const lit = Math.max(0, Math.min(max, Math.round(value)))
  return (
    <span
      role="img"
      data-slot="stars"
      aria-label={label ?? `${value} out of ${max} stars`}
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
