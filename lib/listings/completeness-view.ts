/**
 * How completeness is shown to a given reader. Pure and client-safe.
 */
import { areaForSegment } from "@/lib/listings/areas"
import type {
  CompletenessCheck,
  CompletenessFix,
  CompletenessImportance,
} from "@/lib/listings/completeness"

/**
 * The fix link this reader can follow: an owner/admin-only area (People,
 * Verification) is no fix for a member, who gets none.
 */
export function visibleFix(
  check: Pick<CompletenessCheck, "fix">,
  canManageConsoles: boolean
): CompletenessFix | null {
  const fix = check.fix
  if (!fix) return null
  const segment = fix.href.match(/^\/listings\/[^/?#]+\/([^/?#]+)/)?.[1]
  const area = segment ? areaForSegment(segment) : undefined
  return area?.consoleGated && !canManageConsoles ? null : fix
}

const IMPORTANCE_LABEL: Record<CompletenessImportance, string> = {
  necessary: "Essential",
  important: "Important",
  nice: "Nice to have",
}

export function importanceLabel(importance: CompletenessImportance): string {
  return IMPORTANCE_LABEL[importance]
}
