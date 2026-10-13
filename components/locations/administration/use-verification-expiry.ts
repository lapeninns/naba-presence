"use client"

import { useDeadline } from "@/lib/editors/use-deadline"

/**
 * Whether a review or approval deadline has passed.
 *
 * @deprecated The name predates its use outside verification; import
 * `useDeadline` from `@/lib/editors/use-deadline`. Kept so callers in other
 * listing areas keep working until they move.
 */
export function useVerificationExpiry(expiresAt: string) {
  return useDeadline(expiresAt)
}
