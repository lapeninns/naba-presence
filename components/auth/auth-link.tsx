import Link from "next/link"

import { cn } from "@/lib/utils"

/**
 * The plain text link the auth screens use: accent ink, underline on hover,
 * the focus halo. One shape for "Forgot your password?", "Back to sign in"
 * and every other route out of a form, so none of them drifts.
 */
function AuthLink({ className, ...props }: React.ComponentProps<typeof Link>) {
  return (
    <Link
      className={cn(
        "inline-flex min-h-6 items-center rounded-(--np-radius-tag) font-medium text-accent-ink underline-offset-4 focus-halo hover:underline",
        className
      )}
      {...props}
    />
  )
}

export { AuthLink }
