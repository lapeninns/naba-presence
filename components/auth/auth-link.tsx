import Link from "next/link"

import { cn } from "@/lib/utils"

/**
 * The plain text link the auth screens use: accent ink, underlined, the
 * underline thickening on hover (reference `.link`). One shape for "Forgot
 * password?", "Back to sign in" and every other route out of a form, so
 * none of them drifts. 44px tall on touch.
 */
function AuthLink({ className, ...props }: React.ComponentProps<typeof Link>) {
  return (
    <Link
      className={cn(
        "inline-flex min-h-6 items-center rounded-sm font-medium text-accent-ink underline decoration-1 underline-offset-3 focus-halo hover:decoration-2 focus-visible:outline-none pointer-coarse:min-h-11",
        className
      )}
      {...props}
    />
  )
}

export { AuthLink }
