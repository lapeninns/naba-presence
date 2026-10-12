import "server-only"

import {
  bulkAttributesRecoveryAdapter,
  bulkPlaceActionRecoveryAdapter,
} from "@/lib/server/bulk-families/write-attempts"
import { foodMenusRecoveryAdapter } from "@/lib/server/food-menus"
import { hoursRecoveryAdapter } from "@/lib/server/hours"
import { mediaRecoveryAdapter } from "@/lib/server/media"
import {
  createRecoveryRegistry,
  defaultRecoveryDeps,
  type RecoveryAdapter,
  type RecoveryDeps,
} from "@/lib/server/mutation-recovery"
import { localPostRecoveryAdapter } from "@/lib/server/posts"
import { profileRecoveryAdapter } from "@/lib/server/profile"

/**
 * Every surface that records operation receipts, by (surface, attempt
 * table). A receipt whose pair is missing here is stopped as
 * `recovery_unsupported` and handed to a person rather than retried, so a
 * new surface that writes receipts must add its adapter
 * (tests/mutation-recovery.test.ts checks the list against the surfaces).
 * Business information, attributes, lodging and Place Action links record
 * no receipts from their editors: their reviewed change sets keep their own
 * execution and confirmation states (lib/server/gbp-confirmation.ts,
 * lib/server/place-action-execution.ts). Bulk attribute and action-link
 * writes do record them, on bulk_listing_write_attempt
 * (lib/server/bulk-families/write-attempts.ts); bulk hours use the hours
 * adapter.
 */
export const RECOVERY_ADAPTERS = [
  hoursRecoveryAdapter,
  profileRecoveryAdapter,
  foodMenusRecoveryAdapter,
  localPostRecoveryAdapter,
  mediaRecoveryAdapter,
  bulkAttributesRecoveryAdapter,
  bulkPlaceActionRecoveryAdapter,
] as unknown as ReadonlyArray<RecoveryAdapter<never>>

let deps: RecoveryDeps | undefined

/** The production dependencies of lib/server/mutation-recovery.ts. */
export function recoveryDeps(): RecoveryDeps {
  deps ??= defaultRecoveryDeps(createRecoveryRegistry(RECOVERY_ADAPTERS))
  return deps
}
