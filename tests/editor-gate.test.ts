import { describe, expect, it } from "vitest"

import { ASK_OWNER_OR_ADMIN, editorGate } from "@/lib/editors/gate"
import {
  editDisabledReason,
  resourceDisabledReason,
  type LocationCapabilities,
} from "@/lib/locations/gating"
import { locationCapabilitiesSchema } from "@/lib/contracts/location-capabilities"

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

  it("shows an unverified listing as an advisory while editing and publishing stay available", () => {
    const available = locationCapabilitiesSchema.parse({
      ...caps(null),
      resources: {
        hours: { state: "available", advisoryCode: "verification_unconfirmed" },
      },
    })
    const editReason = editDisabledReason(available)
    const publishReason = resourceDisabledReason(available, "hours", true)
    expect(editReason).toBeNull()
    expect(publishReason).toBeNull()
    expect(
      editorGate({
        caps: available,
        resource: "hours",
        editReason,
        publishReason,
        noun: "these hours",
        savesHere: true,
      })
    ).toEqual({
      tone: "warning",
      title: "Google verification isn’t confirmed for this listing",
      description:
        "You can keep editing, save here and submit changes to Google. Some changes may not appear until verification is complete.",
      code: "verification_unconfirmed",
    })
  })

  it("keeps a role or publishing blocker ahead of the verification advisory", () => {
    const available = locationCapabilitiesSchema.parse({
      ...caps(null),
      resources: {
        hours: { state: "available", advisoryCode: "verification_unconfirmed" },
      },
    })
    expect(
      editorGate({
        caps: { ...available, canEditCanonical: false },
        resource: "hours",
        editReason: "Only owners and admins can edit.",
        publishReason: null,
        noun: "these hours",
        savesHere: true,
      })?.title
    ).toBe("You can look, but not change these hours")
    expect(
      editorGate({
        caps: available,
        resource: "hours",
        editReason: null,
        publishReason: "Publishing to Google is currently unavailable.",
        noun: "these hours",
        savesHere: true,
      })?.title
    ).toBe("Publishing to Google is switched off in NabaPresence")
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

  it("reads a billing hold as a hold on the workspace, not a role limit", () => {
    expect(
      gate("billing_read_only", {
        publishReason: "Your plan is read-only.",
      })
    ).toMatchObject({
      tone: "blocked",
      title: "Publishing is on hold for this workspace",
      code: "billing_read_only",
    })
    const held = editorGate({
      caps: { canEditCanonical: true, canPublish: true, canWrite: false },
      resource: "hours",
      editReason: "This workspace's subscription is read-only.",
      publishReason: null,
      noun: "these hours",
      savesHere: true,
    })
    expect(held).toMatchObject({
      tone: "blocked",
      title: "Changes to these hours are on hold for this workspace",
      code: "billing_read_only",
    })
    // Owners and admins are held too: nobody to ask.
    expect(held?.description).not.toContain(ASK_OWNER_OR_ADMIN)
  })

  it("names the login, verification and Google's own limits plainly", () => {
    expect(
      gate("reconnect_required", { publishReason: "Reconnect." })
    ).toMatchObject({
      tone: "blocked",
      title: "The Google login for this listing needs reconnecting",
    })
    expect(
      gate("verification_required", { publishReason: "Verify." })
    ).toMatchObject({
      tone: "warning",
      title: "Google needs this listing verified first",
    })
    expect(
      gate("provider_capability_retired", { publishReason: "Retired." })
    ).toMatchObject({
      tone: "read_only",
      title: "Google no longer accepts changes to these hours",
    })
    expect(gate("location_ineligible", { publishReason: "No." })).toMatchObject(
      { tone: "read_only", title: "You can’t publish this to Google" }
    )
  })

  it("reads the publish switch as switched off even without a resource code", () => {
    expect(
      editorGate({
        caps: { canEditCanonical: true, canPublish: true },
        resource: "hours",
        editReason: null,
        publishReason: "Publishing to Google is currently unavailable.",
        noun: "these hours",
        savesHere: false,
      })
    ).toMatchObject({
      tone: "blocked",
      title: "Publishing to Google is switched off in NabaPresence",
      code: null,
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
