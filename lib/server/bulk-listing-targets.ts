import "server-only"

import type { BulkOperationInput } from "@/lib/domain/bulk-merge"
import { bulkFamily, type TargetPlan } from "@/lib/server/bulk-families"
import type { GbpLocationContext } from "@/lib/server/gbp-management"

export type { TargetPlan }

/**
 * A listing's frozen plan: eligibility, current value, the value to send
 * and its update mask. Read only; each family plans its own listings
 * (lib/server/bulk-families/*), and the runner dispatches through the same
 * family.
 */
export function planTarget(
  input: BulkOperationInput,
  linked: GbpLocationContext
): Promise<TargetPlan> {
  return bulkFamily(input.operation).plan(input, linked)
}
