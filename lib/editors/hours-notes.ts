import type { HoursState } from "@/lib/api/location-hours"

/**
 * The non-blocking notes above the opening-hours editor, as one list.
 *
 * Each of these used to be its own banner, so a phone could stack three or
 * four tinted panels before the first day row — and two of them said the
 * same thing: the server's boundary warning ("Some saved periods have no
 * confirmed closing day…") and the editor's own "Confirm saved closing days"
 * notice with its button. The tab now renders this list as ONE notice.
 *
 * The capability gate (a role that cannot edit, publishing paused) is not a
 * note: it explains why the editor is disabled and stays its own banner.
 */
export type HoursNote = {
  key: string
  tone: "info" | "warning"
  title?: string
  description: string
  /** The note carries the "Match Google closing boundaries" action. */
  action?: "reconcile"
}

/**
 * The server's wording for the boundary reconciliation blocker
 * (lib/domain/hours.ts `buildGoogleHoursPatch`). Matched loosely so a
 * punctuation tweak there does not bring the duplicate back.
 */
const RECONCILIATION_WARNING = /no confirmed closing day/i

export function hoursNotes(
  hours: Pick<HoursState, "status" | "warnings" | "reconciliationRequired">,
  { gated, googleEmpty }: { gated: boolean; googleEmpty: boolean }
): HoursNote[] {
  const notes: HoursNote[] = []
  if (!gated && hours.status === "conflict") {
    notes.push({
      key: "conflict",
      tone: "warning",
      title: "Google holds a different schedule",
      description:
        "The saved schedule and Google differ. Review both versions before deciding which hours to publish.",
    })
  }
  if (!gated && googleEmpty && hours.status !== "conflict") {
    notes.push({
      key: "google-empty",
      tone: "info",
      title: "Google has no opening hours for this listing",
      description:
        "Customers see “Hours not available”. Switch on the days the business opens, set the times, then publish.",
    })
  }
  if (hours.reconciliationRequired) {
    notes.push({
      key: "reconcile",
      tone: "warning",
      title: "Confirm saved closing days",
      description:
        "Some older periods did not store their ending day or date. Check Google’s current boundaries, review them here, and save. Any period with edited times must be confirmed manually.",
      action: "reconcile",
    })
  }
  const seen = new Set<string>()
  for (const warning of hours.warnings) {
    if (seen.has(warning)) continue
    seen.add(warning)
    if (hours.reconciliationRequired && RECONCILIATION_WARNING.test(warning))
      continue
    notes.push({
      key: `warning:${warning}`,
      tone: "warning",
      description: warning,
    })
  }
  return notes
}
