import type { CapabilityTone } from "@/components/editors/capability-banner"
import type { LocationCapabilities } from "@/lib/locations/gating"

export type EditorGate = {
  tone: CapabilityTone
  title: string
  description: string
  code: string | null
}

/**
 * The one banner an editor shows when it can't do everything it looks like
 * it can, derived only from the reasons the capability evaluators already
 * produced (never invented). A role limit reads as "look, don't change"; a
 * paused or disconnected resource reads as blocked, with the machine reason
 * code folded behind "Details for support".
 *
 * "Paused" (`publishing_paused`) is NabaPresence's own publishing switch,
 * set for the whole installation: not the client's Google login (that is
 * "disconnected") and not a role limit. The banner says so, and who can
 * turn it back on, because "paused" alone read as something the operator
 * had done or could undo.
 *
 * `noun` names the thing ("this profile", "these hours").
 */
export function editorGate({
  caps,
  resource,
  editReason,
  publishReason,
  noun,
  savesHere,
}: {
  caps: LocationCapabilities | undefined
  resource: string
  editReason: string | null
  publishReason: string | null
  noun: string
  /** The editor can still save NabaPresence's copy while publishing is off. */
  savesHere: boolean
}): EditorGate | null {
  const code = caps?.resources?.[resource]?.reasonCode ?? null
  if (editReason) {
    return {
      tone: "read_only",
      title: `You can look, but not change ${noun}`,
      description: editReason,
      code: code === "permission_denied" ? code : null,
    }
  }
  if (!publishReason) return null
  const paused = code === "publishing_paused"
  return {
    tone:
      paused || code === "google_location_not_linked" ? "blocked" : "read_only",
    title: paused
      ? "Publishing to Google is switched off in NabaPresence"
      : code === "google_location_not_linked"
        ? "This listing isn’t linked to Google"
        : "You can’t publish this to Google",
    description: [
      paused
        ? "It’s off for every listing in this NabaPresence installation, not because of anything on Google or this listing. Whoever runs NabaPresence for your team can switch it back on."
        : publishReason,
      savesHere
        ? "You can keep editing and save here; nothing reaches Google until publishing is possible."
        : null,
    ]
      .filter(Boolean)
      .join(" "),
    code,
  }
}
