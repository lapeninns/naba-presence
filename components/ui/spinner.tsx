import { cn } from "@/lib/utils"

/**
 * An activity indicator (reference `.spinner`): a 14px ring in the control
 * edge colour with one open quarter, turning continuously. Unlike `Skeleton`
 * it says work is happening, not what shape the content will have.
 *
 * `decorative` drops the status role for a spinner inside a region that
 * already announces itself; nesting two `role="status"` regions makes a
 * screen reader read both. `tone="current"` draws the ring in the text colour
 * (inside a button or on the charcoal bar).
 */
const SPINNER_SIZES = {
  sm: "size-3.5",
  default: "size-4",
  lg: "size-6 border-[2.5px]",
} as const

function Spinner({
  className,
  label = "Loading",
  decorative = false,
  size = "default",
  tone = "default",
  ...props
}: React.ComponentProps<"span"> & {
  label?: string
  decorative?: boolean
  /** `sm` sits inline with 13px text; `lg` centres a panel. */
  size?: keyof typeof SPINNER_SIZES
  /** `current` uses the surrounding text colour for the ring. */
  tone?: "default" | "current"
}) {
  return (
    <span
      role={decorative ? undefined : "status"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
      data-slot="spinner"
      className="inline-flex shrink-0 items-center justify-center"
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "block animate-spin rounded-full border-2 border-r-transparent [animation-duration:700ms] [animation-timing-function:linear] motion-reduce:animate-none",
          tone === "current"
            ? "border-current border-r-transparent"
            : "border-line-strong border-r-transparent",
          SPINNER_SIZES[size],
          className
        )}
      />
    </span>
  )
}

export { Spinner }
