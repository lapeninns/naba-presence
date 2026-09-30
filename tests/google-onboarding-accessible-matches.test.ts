import { expect, it } from "vitest"
import { googleLocationMatchSchema } from "@/lib/contracts/google-onboarding"
import { correlateOnboardingMatch, onboardingAccessibleLocationsPageSchema } from "@/lib/domain/google-onboarding-accessible-matches"

const locations = [{ name: "locations/exact", title: "Different provider title", placeId: "place:exact" }]

it.each([
  { location: { name: "locations/exact" }, status: "accessible" },
  { location: { metadata: { placeId: "place:exact" } }, status: "accessible" },
  { location: { name: "locations/exact", metadata: { placeId: "place:exact" } }, status: "accessible" },
  { location: { name: "locations/exact", metadata: { placeId: "place:other" } }, status: "identity_unconfirmed" },
  { location: { name: "locations/absent", metadata: { placeId: "place:exact" } }, status: "identity_unconfirmed" },
  { location: { name: "locations/absent" }, status: "not_accessible" },
  { location: { metadata: { placeId: "place:absent" } }, status: "not_accessible" },
  { location: { title: "Different provider title" }, status: "identity_unconfirmed" },
  { location: { metadata: { placeId: "" } }, status: "identity_unconfirmed" },
  { location: { metadata: { placeId: 17 } }, status: "identity_unconfirmed" },
])("correlates exact identities when $location produces $status", ({ location, status }) => {
  const match = googleLocationMatchSchema.parse({ name: "googleLocations/search-id", location, requestAdminRightsUri: "https://business.google.com/ownership" })
  const result = correlateOnboardingMatch(match, locations)
  expect(result.status).toBe(status)
  if (result.status === "accessible") expect(result.location).toEqual(locations[0])
})

it("keeps duplicate place identities ambiguous when multiple accessible resources share them", () => {
  const match = googleLocationMatchSchema.parse({ name: "googleLocations/search-id", location: { metadata: { placeId: "place:exact" } } })
  const result = correlateOnboardingMatch(match, [...locations, { name: "locations/duplicate", placeId: "place:exact" }])
  expect(result).toEqual({ matchName: match.name, status: "ambiguous" })
})

it.each([null, { locations: null }, { locations: [{ name: "googleLocations/search-id" }] }, { locations: [{ name: "locations/exact", metadata: { placeId: 3 } }] }, { nextPageToken: 3 }])("rejects malformed account pages when provider returns %j", (value) => {
  expect(onboardingAccessibleLocationsPageSchema.safeParse(value).success).toBe(false)
})
