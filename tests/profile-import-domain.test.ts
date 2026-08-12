import { describe, expect, it } from "vitest"

import { buildProfileProposals, type ProfileFieldComparison } from "@/lib/domain/profile-import"

function field(overrides: Partial<ProfileFieldComparison>): ProfileFieldComparison {
  return {
    key: "name",
    policy: "bidirectional",
    status: "in_sync",
    canonicalValue: "Old Crown",
    googleValue: "Old Crown",
    lastReconciledAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("profile import proposals", () => {
  it("stages google_dirty fields", () => {
    const proposals = buildProfileProposals({
      fields: [field({ status: "google_dirty", googleValue: "The Old Crown" })],
    })
    expect(proposals).toHaveLength(1)
    expect(proposals[0].suggestedPatch).toEqual({
      op: "set_field",
      fieldKey: "name",
      value: "The Old Crown",
    })
    expect(proposals[0].warnings).toEqual([])
  })

  it("marks conflicts so the UI demands an overwrite acknowledgement", () => {
    const proposals = buildProfileProposals({
      fields: [field({ status: "conflict", canonicalValue: "Ours", googleValue: "Theirs" })],
    })
    expect(proposals[0].warnings).toContain("canonical_also_changed")
  })

  it("flags conflicts that come from missing baselines", () => {
    const proposals = buildProfileProposals({
      fields: [field({ status: "conflict", googleValue: "Theirs", lastReconciledAt: null })],
    })
    expect(proposals[0].warnings).toContain("no_baseline")
  })

  it("never proposes blanking local data from an empty Google value", () => {
    expect(
      buildProfileProposals({
        fields: [field({ status: "google_dirty", googleValue: null })],
      })
    ).toHaveLength(0)
  })

  it("skips read-only and in-sync and locally-edited fields", () => {
    expect(
      buildProfileProposals({
        fields: [
          field({ key: "mapsUrl", policy: "google_read_only", status: "google_dirty", googleValue: "x" }),
          field({ status: "in_sync" }),
          field({ key: "phone", status: "core_dirty", googleValue: "0121" }),
        ],
      })
    ).toHaveLength(0)
  })
})
