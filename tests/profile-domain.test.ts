import { describe, expect, it } from "vitest"

import {
  buildGoogleProfilePatch,
  classifyProfileField,
  normalizeGoogleProfile,
  type NormalizedProfile,
} from "@/lib/domain/profile"

describe("standalone profile domain", () => {
  it("normalizes Google identity fields", () => {
    expect(normalizeGoogleProfile({
      title: " Old Crown Girton ",
      profile: { description: "Local  food and ales" },
      phoneNumbers: { primaryPhone: "+44 1223 000000" },
      storefrontAddress: { addressLines: ["89 High Street"], locality: "Girton", postalCode: "CB3 0QD", regionCode: "GB" },
      websiteUri: "https://example.com",
      metadata: { mapsUri: "https://maps.google.com/?cid=123", newReviewUri: "https://g.page/r/example/review" },
    })).toEqual({
      name: "Old Crown Girton",
      description: "Local food and ales",
      phone: "+44 1223 000000",
      address: "89 High Street, Girton, CB3 0QD, GB",
      mapsUrl: "https://maps.google.com/?cid=123",
      reviewUrl: "https://g.page/r/example/review",
      website: "https://example.com",
    })
  })

  it("builds supported Google patches from NabaPresence values", () => {
    const canonical: NormalizedProfile = {
      name: "Old Crown Girton",
      description: "Local food and ales",
      phone: "+44 1223 000000",
      website: "https://example.com",
      address: null,
      mapsUrl: null,
      reviewUrl: null,
    }
    expect(buildGoogleProfilePatch({ canonical, selectedFields: ["name", "description", "phone", "website", "address"] })).toEqual({
      payload: {
        title: "Old Crown Girton",
        profile: { description: "Local food and ales" },
        phoneNumbers: { primaryPhone: "+44 1223 000000" },
        websiteUri: "https://example.com",
      },
      updateMask: ["title", "profile", "phoneNumbers", "websiteUri"],
    })
  })

  it("classifies independent and conflicting edits against baselines", () => {
    expect(classifyProfileField({ canonicalHash: "same", googleHash: "same", baselineCanonicalHash: null, baselineGoogleHash: null })).toBe("in_sync")
    expect(classifyProfileField({ canonicalHash: "local", googleHash: "base", baselineCanonicalHash: "base", baselineGoogleHash: "base" })).toBe("core_dirty")
    expect(classifyProfileField({ canonicalHash: "local", googleHash: "google", baselineCanonicalHash: "base", baselineGoogleHash: "base" })).toBe("conflict")
  })
})
