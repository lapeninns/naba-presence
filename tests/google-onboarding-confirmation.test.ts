import { expect, it } from "vitest"
import { onboardingPayloadMatches } from "@/lib/domain/google-onboarding-confirmation"

it.each([undefined, 0])("confirms an unknown opening day represented as %s", (day) => {
  for (const approvedDay of [undefined, 0]) {
    const expected = { openInfo: { status: "OPEN", openingDate: { year: 2024, month: 2, ...(approvedDay === undefined ? {} : { day: approvedDay }) } } }
    const observed = { openInfo: { status: "OPEN", canReopen: true, openingDate: { year: 2024, month: 2, ...(day === undefined ? {} : { day }) } } }
    expect(onboardingPayloadMatches(expected, observed)).toBe(true)
  }
})

it("does not confirm an invented day or a different month/year", () => {
  const expected = { openInfo: { openingDate: { year: 2024, month: 2 } } }
  for (const openingDate of [{ year: 2024, month: 2, day: 1 }, { year: 2024, month: 3 }, { year: 2023, month: 2 }]) {
    expect(onboardingPayloadMatches(expected, { openInfo: { openingDate } })).toBe(false)
  }
})

it("requires an exact supplied day and opening state", () => {
  const expected = { openInfo: { status: "OPEN", openingDate: { year: 2024, month: 2, day: 29 } } }
  expect(onboardingPayloadMatches(expected, expected)).toBe(true)
  expect(onboardingPayloadMatches(expected, { openInfo: { status: "OPEN", openingDate: { year: 2024, month: 2 } } })).toBe(false)
  expect(onboardingPayloadMatches(expected, { openInfo: { ...expected.openInfo, status: "CLOSED_TEMPORARILY" } })).toBe(false)
})

it("rejects missing approved fields while permitting provider output metadata", () => {
  const expected = { title: "Example", storefrontAddress: { addressLines: ["First", "Second"] }, labels: ["A", "B"] }
  expect(onboardingPayloadMatches(expected, { ...expected, metadata: { hasVoiceOfMerchant: false } })).toBe(true)
  expect(onboardingPayloadMatches(expected, { title: "Example", labels: ["A", "B"] })).toBe(false)
  expect(onboardingPayloadMatches(expected, { ...expected, storefrontAddress: { addressLines: ["Second", "First"] } })).toBe(false)
})

it("confirms reordered child relationships but rejects missing, changed and duplicate children", () => {
  const first = { placeId: "ChIJ_first", relationType: "DEPARTMENT_OF" } as const
  const second = { placeId: "ChIJ_second", relationType: "INDEPENDENT_ESTABLISHMENT_IN" } as const
  const expected = { relationshipData: { parentChain: "chains/123", childrenLocations: [first, second] } }
  expect(onboardingPayloadMatches(expected, { relationshipData: { parentChain: "chains/123", childrenLocations: [second, first] } })).toBe(true)
  for (const childrenLocations of [[first], [first, first], [first, { ...second, relationType: "DEPARTMENT_OF" }]]) {
    expect(onboardingPayloadMatches(expected, { relationshipData: { parentChain: "chains/123", childrenLocations } })).toBe(false)
  }
  expect(onboardingPayloadMatches(expected, { relationshipData: { parentChain: "chains/wrong", childrenLocations: [second, first] } })).toBe(false)
})

it("requires the exact proposed parent while allowing unapproved provider relationship metadata", () => {
  const parent = { placeId: "ChIJ_parent", relationType: "DEPARTMENT_OF" } as const
  const expected = { relationshipData: { parentLocation: parent } }
  expect(onboardingPayloadMatches(expected, { relationshipData: { parentLocation: parent, futureMetadata: "output" } })).toBe(true)
  expect(onboardingPayloadMatches(expected, { relationshipData: {} })).toBe(false)
  expect(onboardingPayloadMatches(expected, { relationshipData: { parentLocation: { ...parent, placeId: "ChIJ_wrong" } } })).toBe(false)
})
