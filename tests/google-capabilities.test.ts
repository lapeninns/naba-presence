import { describe, expect, it } from "vitest"

import { BUSINESS_INFORMATION_UPDATE_MASKS } from "@/lib/domain/business-information"
import {
  GOOGLE_LOCATION_FIELDS,
  googleCapabilityDetailsSchema,
  locationFieldCapabilities,
  metadataEligibility,
} from "@/lib/domain/google-capabilities"

const observedAt = "2026-09-29T12:00:00.000Z"
const permitted = { canPublish: true, writesEnabled: true, observedAt }

describe("Google field capability projection", () => {
  it.each([
    [{}, "unknown"],
    [{ metadata: null }, "unknown"],
    [{ metadata: { canModifyServiceList: "true" } }, "unknown"],
    [{ metadata: { canModifyServiceList: false } }, "ineligible"],
    [{ metadata: { canModifyServiceList: true } }, "eligible"],
  ])("distinguishes observed metadata %j as %s", (location, expected) => {
    expect(metadataEligibility(location, "canModifyServiceList")).toBe(expected)
  })

  it("does not present missing service metadata as confirmed support or ineligibility", () => {
    const result = locationFieldCapabilities({ ...permitted, location: {} })
    expect(result.fields.serviceItems).toMatchObject({
      support: "supported", eligibility: "unknown", canWrite: false,
      reasonCode: "eligibility_unknown", observedAt,
      eligibilitySource: "location.metadata.canModifyServiceList",
    })
    expect(googleCapabilityDetailsSchema.safeParse(result).success).toBe(true)
  })

  it("allows validation of ordinary fields without inventing provider acceptance", () => {
    const result = locationFieldCapabilities({ ...permitted, location: {} })
    expect(result.fields.title).toMatchObject({
      eligibility: "unknown", canWrite: false, canValidate: true,
      eligibilitySource: "locations.patch(validateOnly=true)",
    })
  })

  it.each([
    [{ canPublish: false, writesEnabled: true }, "permission_denied"],
    [{ canPublish: true, writesEnabled: false }, "publishing_paused"],
  ])("applies local write policy %j even when Google confirms eligibility", (policy, reasonCode) => {
    const result = locationFieldCapabilities({
      ...permitted, ...policy, location: { metadata: { canModifyServiceList: true } },
    })
    expect(result.fields.serviceItems).toMatchObject({
      eligibility: "eligible", canWrite: false, canValidate: false, reasonCode,
    })
  })

  it("keeps output fields and immutable fields unavailable for updates", () => {
    const result = locationFieldCapabilities({ ...permitted, location: {} })
    expect(result.fields.metadata).toMatchObject({ canWrite: false, canValidate: false, reasonCode: "provider_read_only" })
    expect(result.fields["openInfo.canReopen"]).toMatchObject({ canWrite: false, reasonCode: "provider_read_only" })
    expect(result.fields["serviceArea.regionCode"]).toMatchObject({ support: "create_only", reasonCode: "immutable_after_creation" })
    expect(result.fields.latlng).toMatchObject({ canWrite: false, handoffUrl: "https://business.google.com/" })
  })

  it("classifies every currently accepted Business Information update mask", () => {
    for (const field of BUSINESS_INFORMATION_UPDATE_MASKS) {
      expect(GOOGLE_LOCATION_FIELDS[field].support).toBe("supported")
    }
  })
})
