import { expect, it } from "vitest"
import { onboardingMatchLinkInputSchema, onboardingMatchLinkProviderSchema } from "@/lib/contracts/google-onboarding-match-link"

const request = { expectedRevision: 1, expectedMatchCheckedAt: "2026-09-30T00:00:00.000Z", matchName: "googleLocations/exact", localName: " Local name " }

it("retains the exact match identity when a local name is normalised", () => {
  expect(onboardingMatchLinkInputSchema.parse(request)).toEqual({ ...request, localName: "Local name" })
})

it.each([
  { ...request, matchName: "locations/invented" },
  { ...request, localName: " " },
  { ...request, organisationId: "00000000-0000-4000-8000-000000000001" },
  { ...request, providerResourceName: "locations/arbitrary" },
  { ...request, expectedRevision: 0 },
])("rejects unsafe match-link input when supplied %j", (input) => {
  expect(onboardingMatchLinkInputSchema.safeParse(input).success).toBe(false)
})

it("keeps unknown verification distinct from false when preparing a provider snapshot", () => {
  const snapshot = { name: "locations/exact", title: "Provider title", address: null, verified: null }
  expect(onboardingMatchLinkProviderSchema.parse(snapshot).verified).toBeNull()
  expect(onboardingMatchLinkProviderSchema.parse({ ...snapshot, verified: false }).verified).toBe(false)
})
