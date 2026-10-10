import "server-only"

import { businessInformationRecoveryAdapter } from "@/lib/server/business-information"
import { foodMenusRecoveryAdapter } from "@/lib/server/food-menus"
import { hoursRecoveryAdapter } from "@/lib/server/hours"
import { industryRecoveryAdapter } from "@/lib/server/industry-management"
import { mediaRecoveryAdapter } from "@/lib/server/media"
import {
  createRecoveryRegistry,
  defaultRecoveryDeps,
  type RecoveryAdapter,
  type RecoveryDeps,
} from "@/lib/server/mutation-recovery"
import { placeActionRecoveryAdapter } from "@/lib/server/place-actions"
import { localPostRecoveryAdapter } from "@/lib/server/posts"
import { profileRecoveryAdapter } from "@/lib/server/profile"

/**
 * Every surface that records operation receipts, by (surface, attempt
 * table). A receipt whose pair is missing here is stopped as
 * `recovery_unsupported` and handed to a person rather than retried, so a
 * new surface that writes receipts must add its adapter
 * (tests/mutation-recovery.test.ts checks the list against the surfaces).
 */
export const RECOVERY_ADAPTERS = [
  hoursRecoveryAdapter,
  profileRecoveryAdapter,
  foodMenusRecoveryAdapter,
  businessInformationRecoveryAdapter,
  industryRecoveryAdapter,
  localPostRecoveryAdapter,
  placeActionRecoveryAdapter,
  mediaRecoveryAdapter,
] as unknown as ReadonlyArray<RecoveryAdapter<never>>

let deps: RecoveryDeps | undefined

/** The production dependencies of lib/server/mutation-recovery.ts. */
export function recoveryDeps(): RecoveryDeps {
  deps ??= defaultRecoveryDeps(createRecoveryRegistry(RECOVERY_ADAPTERS))
  return deps
}
