import type { CapabilityTone } from "@/components/editors/capability-banner"
import {
  reasonCodeMessage,
  type LocationCapabilities,
} from "@/lib/locations/gating"

/**
 * The way forward for someone whose role lets them look but not change:
 * one sentence, shared by the editor banners and LocationTab's role gate so
 * the wording can't drift.
 */
export const ASK_OWNER_OR_ADMIN =
  "Ask an owner or admin if something here needs to change."

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
 * A role limit also says what to do instead (ask an owner or admin); a
 * billing hold doesn't, since it holds owners and admins too.
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
  // A billing hold holds owners and admins too: not a role limit, and no
  // "ask an owner or admin".
  const billing = caps?.canWrite === false || code === "billing_read_only"
  if (editReason && billing) {
    return {
      tone: "blocked",
      title: `Changes to ${noun} are on hold for this workspace`,
      description: editReason,
      code: "billing_read_only",
    }
  }
  if (editReason) {
    const roleLimit =
      caps?.canWrite !== false && caps?.canEditCanonical === false
    return {
      tone: "read_only",
      title: `You can look, but not change ${noun}`,
      description: roleLimit
        ? `${editReason} ${ASK_OWNER_OR_ADMIN}`
        : editReason,
      code: code === "permission_denied" ? code : null,
    }
  }
  if (!publishReason) {
    if (
      caps?.resources?.[resource]?.advisoryCode === "verification_unconfirmed"
    ) {
      return {
        tone: "warning",
        title: "Google verification isn’t confirmed for this listing",
        description: savesHere
          ? "You can keep editing, save here and submit changes to Google. Some changes may not appear until verification is complete."
          : "You can submit changes to Google. Some changes may not appear until verification is complete.",
        code: "verification_unconfirmed",
      }
    }
    return null
  }
  // The installation's switch reaches an editor either as the resource's
  // code or, for a resource with no capability row, only as the publish
  // gate's sentence; both are the same switch.
  const paused =
    code === "publishing_paused" ||
    (code === null && publishReason === reasonCodeMessage("publishing_paused"))
  const notLinked = code === "google_location_not_linked"
  const reconnect = code === "reconnect_required"
  const verification = code === "verification_required"
  const retired = code === "provider_capability_retired"
  return {
    // Blocked: something outside this person's role stops every publish
    // until it is fixed. A role limit or Google's own rule stays read-only.
    tone:
      paused || notLinked || reconnect || billing
        ? "blocked"
        : verification
          ? "warning"
          : "read_only",
    title: paused
      ? "Publishing to Google is switched off in NabaPresence"
      : notLinked
        ? "This listing isn’t linked to Google"
        : reconnect
          ? "The Google login for this listing needs reconnecting"
          : verification
            ? "Google needs this listing verified first"
            : retired
              ? `Google no longer accepts changes to ${noun}`
              : billing
                ? "Publishing is on hold for this workspace"
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
