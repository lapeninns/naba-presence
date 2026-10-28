import { describe, expect, it } from "vitest"

import { ASK_OWNER_OR_ADMIN, editorGate } from "@/lib/editors/gate"
import type { LocationCapabilities } from "@/lib/locations/gating"

/**
 * The one banner the profile, hours, menu and booking editors show when they
 * cannot do everything they look like they can (lib/editors/gate.ts).
 */

const caps = (reasonCode: string | null): LocationCapabilities => ({
  canEditCanonical: true,
  canPublish: reasonCode === null,
  resources: {
    hours:
      reasonCode === null
        ? { state: "available" }
        : { state: "blocked", reasonCode },
  },
})

const gate = (
  reasonCode: string | null,
  reasons: { editReason?: string | null; publishReason?: string | null },
  savesHere = true
) =>
  editorGate({
    caps: caps(reasonCode),
    resource: "hours",
    editReason: reasons.editReason ?? null,
    publishReason: reasons.publishReason ?? null,
    noun: "these hours",
    savesHere,
  })

describe("editorGate", () => {
  it("shows nothing when the editor can both change and publish", () => {
    expect(gate(null, {})).toBeNull()
  })

  it("reads a role limit as look-don't-change, with the evaluator's own words", () => {
    expect(
      gate("permission_denied", {
        editReason: "Only an owner or admin can change hours.",
        publishReason: "Only an owner or admin can publish.",
      })
    ).toEqual({
      tone: "read_only",
      title: "You can look, but not change these hours",
      description: "Only an owner or admin can change hours.",
      code: "permission_denied",
    })
  })

  it("tells a role that can't edit what to do instead", () => {
    const banner = editorGate({
      caps: { canEditCanonical: false, canPublish: false, canWrite: true },
      resource: "hours",
      editReason: "Only owners and admins can edit this location.",
      publishReason: "You do not have permission to publish.",
      noun: "these hours",
      savesHere: true,
    })
    expect(banner?.description).toBe(
      `Only owners and admins can edit this location. ${ASK_OWNER_OR_ADMIN}`
    )
    expect(ASK_OWNER_OR_ADMIN).toBe(
      "Ask an owner or admin if something here needs to change."
    )
  })

  it("offers no ask line when billing holds everyone read-only", () => {
    const banner = editorGate({
      caps: { canEditCanonical: false, canPublish: false, canWrite: false },
      resource: "hours",
      editReason: "This workspace's subscription is read-only.",
      publishReason: "This workspace's subscription is read-only.",
      noun: "these hours",
      savesHere: true,
    })
    expect(banner?.description).toBe(
      "This workspace's subscription is read-only."
    )
  })

  it("keeps a non-role reason code out of a look-don't-change banner", () => {
    expect(
      gate("publishing_paused", { editReason: "Viewers cannot edit." })?.code
    ).toBeNull()
  })

  it("says publishing is NabaPresence's own switch, and who can turn it on", () => {
    const banner = gate("publishing_paused", {
      publishReason: "Publishing is paused.",
    })
    expect(banner).toMatchObject({
      tone: "blocked",
      title: "Publishing to Google is switched off in NabaPresence",
      code: "publishing_paused",
    })
    expect(banner?.description).toMatch(/not because of anything on Google/)
    expect(banner?.description).toMatch(/can switch it back on/)
    expect(banner?.description).not.toContain("Publishing is paused.")
  })

  it("blocks an unlinked listing and names the problem", () => {
    expect(
      gate("google_location_not_linked", {
        publishReason: "Link this listing to Google first.",
      })
    ).toMatchObject({
      tone: "blocked",
      title: "This listing isn’t linked to Google",
      description: expect.stringContaining(
        "Link this listing to Google first."
      ),
      code: "google_location_not_linked",
    })
  })

  it("reads any other publish limit as read-only, with its reason", () => {
    expect(
      gate("billing_read_only", {
        publishReason: "Your plan is read-only.",
      })
    ).toMatchObject({
      tone: "read_only",
      title: "You can’t publish this to Google",
      code: "billing_read_only",
    })
  })

  it("says saving here still works only when the editor saves locally", () => {
    const saves = gate("billing_read_only", { publishReason: "Read-only." })
    const writesOnly = gate(
      "billing_read_only",
      { publishReason: "Read-only." },
      false
    )
    expect(saves?.description).toBe(
      "Read-only. You can keep editing and save here; nothing reaches Google until publishing is possible."
    )
    expect(writesOnly?.description).toBe("Read-only.")
  })

  it("has no reason code before the capabilities arrive", () => {
    expect(
      editorGate({
        caps: undefined,
        resource: "hours",
        editReason: null,
        publishReason: "Checking access.",
        noun: "these hours",
        savesHere: false,
      })
    ).toEqual({
      tone: "read_only",
      title: "You can’t publish this to Google",
      description: "Checking access.",
      code: null,
    })
  })
})
