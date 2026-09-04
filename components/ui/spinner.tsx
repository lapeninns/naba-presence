import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * An activity indicator, unlike `Skeleton` — which is a placeholder saying
 * "content will fill this shape", not a signal that work is happening.
 *
 * `decorative` drops the status role for the common case of a spinner sitting
 * inside a region that already announces itself. Nesting two `role="status"`
 * regions makes a screen reader read the wrapper's sentence and then the word
 * "Loading" after it.
 */
function Spinner({
  className,
  label = "Loading",
  decorative = false,
  ...props
}: React.ComponentProps<"span"> & { label?: string; decorative?: boolean }) {
  return (
    <span
      role={decorative ? undefined : "status"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
      data-slot="spinner"
      {...props}
    >
      <Loader2 className={cn("size-4 animate-spin", className)} aria-hidden />
    </span>
  )
}

export { Spinner }
