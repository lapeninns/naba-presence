/**
 * @deprecated Import from `@/lib/errors/action-errors` instead (Sprint 4.4).
 * This shim keeps the posts wording for `second_approver_required` /
 * `approval_not_pending`; pass `{ context: "post" }` when swapping the import
 * in a posts surface.
 */
import {
  describeActionError as describeActionErrorMerged,
  isNotLinkedError,
} from "@/lib/errors/action-errors"

/** @deprecated Use `describeActionError(error, { context: "post" })` from `@/lib/errors/action-errors`. */
export function describeActionError(error: unknown): string {
  return describeActionErrorMerged(error, { context: "post" })
}

/** @deprecated Import from `@/lib/errors/action-errors`. */
export { isNotLinkedError }
