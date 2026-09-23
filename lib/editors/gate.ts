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
 * code beside the sentence for support conversations.
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
      ? "Publishing to Google is paused for this listing"
      : code === "google_location_not_linked"
        ? "This listing isn’t linked to Google"
        : "You can’t publish this to Google",
    description: savesHere
      ? `${publishReason} You can keep editing and save here; nothing reaches Google until publishing is possible.`
      : publishReason,
    code,
  }
}
