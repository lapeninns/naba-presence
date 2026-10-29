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
  /**
   * The action the note carries: "Match Google closing boundaries"
   * (`reconcile`) or "Keep Google’s hours" (`keep-google`). Both only change
   * the draft; nothing is saved until the operator saves.
   */
  action?: "reconcile" | "keep-google"
}

/**
 * The server's wording for the boundary reconciliation blocker
 * (lib/domain/hours.ts `buildGoogleHoursPatch`). Matched loosely so a
 * punctuation tweak there does not bring the duplicate back.
 */
const RECONCILIATION_WARNING = /no confirmed closing day/i

/**
 * The server's note when Google's service options could not be read
 * (`lib/server/hours.ts`). It is about services, not the weekly schedule, so
 * the hours page shows it only where services are edited (`serviceNote`).
 */
export const SERVICE_OPTIONS_WARNING =
  "Some service options couldn’t load, so adding services is unavailable. Try again later."

/** The service-options note when the read carried it, for the service group. */
export function serviceNote(warnings: readonly string[]): string | null {
  return warnings.includes(SERVICE_OPTIONS_WARNING)
    ? SERVICE_OPTIONS_WARNING
    : null
}

export function hoursNotes(
  hours: Pick<HoursState, "status" | "warnings" | "reconciliationRequired">,
  {
    gated,
    googleEmpty,
    draftEmpty,
  }: {
    gated: boolean
    googleEmpty: boolean
    /**
     * The schedule being edited has no open day, special day or service.
     * With hours already waiting here, "switch on your open days" is the
     * wrong advice: they only need publishing.
     */
    draftEmpty: boolean
  }
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
  // Someone changed (or removed) the hours on Google since they were last
  // published from here. Keeping Google's version only fills the draft; it
  // is saved, like any edit, with Save here. With nothing on Google there is
  // nothing to keep, so only the review-and-publish way back is offered.
  if (!gated && hours.status === "google_dirty") {
    notes.push({
      key: "google-changed",
      tone: "warning",
      title: "Hours changed on Google",
      description: googleEmpty
        ? "Someone removed these hours on Google since they were last published from here. Review and publish to put the saved schedule back."
        : "Someone changed these hours on Google since they were last published from here. Keep Google’s hours and save them here, or review and publish to put the saved schedule back.",
      ...(googleEmpty ? {} : { action: "keep-google" as const }),
    })
  }
  // The Google-changed note already says Google's hours were removed.
  if (
    !gated &&
    googleEmpty &&
    hours.status !== "conflict" &&
    hours.status !== "google_dirty"
  ) {
    notes.push({
      key: "google-empty",
      tone: "info",
      title: "No hours on Google",
      description: draftEmpty
        ? "Google shows no hours yet, so customers see “Hours not available”. Switch on your open days."
        : "Google shows no hours yet, so customers see “Hours not available”. Review and publish these hours to put them on Google.",
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
    if (warning === SERVICE_OPTIONS_WARNING) continue
    notes.push({
      key: `warning:${warning}`,
      tone: "warning",
      description: warning,
    })
  }
  return notes
}
