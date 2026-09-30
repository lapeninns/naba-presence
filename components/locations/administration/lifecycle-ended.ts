import { formatInstant } from "@/components/editors/change-diff"
import type { LifecycleAttempt } from "@/lib/contracts/google-lifecycle-review"

/**
 * A lifecycle outcome after which this account no longer manages the
 * location: an independently confirmed deletion, or an independently
 * confirmed transfer whose local account link was not moved with it.
 */
export type LifecycleEnded = {
  readonly operation: "delete_location" | "transfer_location"
  readonly observedAt: string | null
  readonly destination: string | null
}

export function lifecycleEnded(
  attempt: LifecycleAttempt | null | undefined
): LifecycleEnded | null {
  if (!attempt || attempt.confirmationState !== "confirmed") return null
  if (
    attempt.operation === "delete_location" &&
    attempt.postcondition === "location_absent_from_managed_account"
  )
    return {
      operation: "delete_location",
      observedAt: attempt.observedAt,
      destination: null,
    }
  if (
    attempt.operation === "transfer_location" &&
    attempt.postcondition === "location_transferred_between_accounts" &&
    attempt.localReconciliation !== "applied"
  )
    return {
      operation: "transfer_location",
      observedAt: attempt.observedAt,
      destination:
        attempt.request.operation === "transfer_location"
          ? attempt.request.payload.destinationAccount
          : null,
    }
  return null
}

export function lifecycleEndedTitle(ended: LifecycleEnded): string {
  return ended.operation === "delete_location"
    ? "This location was deleted from Google"
    : "This location moved to another Google account"
}

export function lifecycleEndedReason(ended: LifecycleEnded): string {
  const when = ended.observedAt
    ? ` (checked ${formatInstant(ended.observedAt)})`
    : ""
  return ended.operation === "delete_location"
    ? `Google independently confirmed that this location was deleted from the managed account${when}. Access changes are no longer available for it here.`
    : `Google independently confirmed that this location moved to ${ended.destination ?? "another Google account"}${when}. This account no longer manages it, so access changes are unavailable here.`
}
