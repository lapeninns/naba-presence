import "server-only"

import type { BulkOperationInput } from "@/lib/domain/bulk-merge"
import {
  bulkFamily,
  type PlanReads,
  type TargetPlan,
} from "@/lib/server/bulk-families"
import type { GbpLocationContext } from "@/lib/server/gbp-management"

export type { TargetPlan }
export { planReads } from "@/lib/server/bulk-families"

/**
 * A listing's frozen plan: eligibility, current value, the value to send
 * and its update mask. Read only; each family plans its own listings
 * (lib/server/bulk-families/*), and the runner dispatches through the same
 * family. `reads` is the listing's shared read cache (`planReads`), so a
 * batch's changes at one listing are planned against one read per resource.
 */
export function planTarget(
  input: BulkOperationInput,
  linked: GbpLocationContext,
  reads: PlanReads
): Promise<TargetPlan> {
  return bulkFamily(input.operation).plan(input, linked, reads)
}
