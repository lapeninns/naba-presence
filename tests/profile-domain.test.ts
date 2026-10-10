import { describe, expect, it } from "vitest"

import {
  buildGoogleProfilePatch,
  hashGoogleProfile,
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
        phoneNumbers: { primaryPhone: "+44 1223 000000", additionalPhones: [] },
        websiteUri: "https://example.com",
      },
      updateMask: ["title", "profile.description", "phoneNumbers", "websiteUri"],
    })
  })

  it("requires a primary phone while allowing description clearing", () => {
    const canonical: NormalizedProfile = { name: null, description: null, phone: null, website: null, address: null, mapsUrl: null, reviewUrl: null }
    expect(() => buildGoogleProfilePatch({ canonical, selectedFields: ["phone"] })).toThrow("primary phone")
    expect(buildGoogleProfilePatch({ canonical, selectedFields: ["description"] })).toEqual({
      payload: { profile: {} },
      updateMask: ["profile.description"],
    })
  })

  it("preserves additional phones and detects changes to the reviewed collection", () => {
    const location = { phoneNumbers: { primaryPhone: "111", additionalPhones: ["222", "333"] } }
    const canonical = { ...normalizeGoogleProfile(location), phone: "444" }
    expect(buildGoogleProfilePatch({ canonical, selectedFields: ["phone"], googlePhoneNumbers: location.phoneNumbers })).toEqual({ payload: { phoneNumbers: { primaryPhone: "444", additionalPhones: ["222", "333"] } }, updateMask: ["phoneNumbers"] })
    expect(hashGoogleProfile(location, canonical)).not.toBe(hashGoogleProfile({ phoneNumbers: { ...location.phoneNumbers, additionalPhones: ["222"] } }, canonical))
    expect(hashGoogleProfile(location, canonical)).toBe(hashGoogleProfile({ phoneNumbers: { ...location.phoneNumbers, additionalPhones: ["333", "222"] } }, canonical))
  })

  it("classifies independent and conflicting edits against baselines", () => {
    expect(classifyProfileField({ canonicalHash: "same", googleHash: "same", baselineCanonicalHash: null, baselineGoogleHash: null })).toBe("in_sync")
    expect(classifyProfileField({ canonicalHash: "local", googleHash: "base", baselineCanonicalHash: "base", baselineGoogleHash: "base" })).toBe("core_dirty")
    expect(classifyProfileField({ canonicalHash: "local", googleHash: "google", baselineCanonicalHash: "base", baselineGoogleHash: "base" })).toBe("conflict")
  })
})
