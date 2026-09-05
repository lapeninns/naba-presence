import { cn } from "@/lib/utils"

/**
 * An activity indicator, unlike `Skeleton` — which is a placeholder saying
 * "content will fill this shape", not a signal that work is happening.
 *
 * Drawn as the platform's eight-spoke indicator: the spokes fade around the
 * ring and the whole glyph steps through eight positions rather than turning
 * smoothly. Under reduced motion the global rule freezes the animation, and
 * the glyph still reads as "busy" because the fade is baked into the spokes.
 *
 * `decorative` drops the status role for the common case of a spinner sitting
 * inside a region that already announces itself. Nesting two `role="status"`
 * regions makes a screen reader read the wrapper's sentence and then the word
 * "Loading" after it.
 */
const SPINNER_SIZES = {
  sm: "size-3.5",
  default: "size-4",
  lg: "size-6",
} as const

const SPOKES = [1, 0.85, 0.7, 0.55, 0.45, 0.35, 0.28, 0.22]

function Spinner({
  className,
  label = "Loading",
  decorative = false,
  size = "default",
  ...props
}: React.ComponentProps<"span"> & {
  label?: string
  decorative?: boolean
  /** `sm` sits inline with 13px text; `lg` centres a panel. */
  size?: keyof typeof SPINNER_SIZES
}) {
  return (
    <span
      role={decorative ? undefined : "status"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
      data-slot="spinner"
      className="inline-flex shrink-0 items-center justify-center text-ink-muted"
      {...props}
    >
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden
        className={cn(
          "animate-spin [animation-timing-function:steps(8,end)] motion-reduce:animate-none",
          SPINNER_SIZES[size],
          className
        )}
      >
        {SPOKES.map((opacity, index) => (
          <rect
            key={index}
            x="10.75"
            y="2"
            width="2.5"
            height="6"
            rx="1.25"
            opacity={opacity}
            transform={`rotate(${index * 45} 12 12)`}
          />
        ))}
      </svg>
    </span>
  )
}

export { Spinner }
