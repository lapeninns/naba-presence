import { expect, it } from "vitest"
import { removeOnboardingChain, removeOnboardingRelationship, onboardingRelationshipReviewRows } from "@/lib/locations/onboarding-relationships"

const parent = { placeId: "ChIJ_parent", relationType: "DEPARTMENT_OF" } as const
const child = { placeId: "ChIJ_child", relationType: "INDEPENDENT_ESTABLISHMENT_IN" } as const
const second = { placeId: "ChIJ_second", relationType: "DEPARTMENT_OF" } as const

it("omits only the proposed chain and preserves related businesses", () => {
  expect(removeOnboardingChain({ parentChain: "chains/123", parentLocation: parent, childrenLocations: [child] })).toEqual({ parentLocation: parent, childrenLocations: [child] })
  expect(removeOnboardingChain({ parentChain: "chains/123" })).toBeUndefined()
})

it("removes only the proposed parent and preserves chain and child siblings", () => {
  expect(removeOnboardingRelationship({ parentChain: "chains/123", parentLocation: parent, childrenLocations: [child] }, { parent: true })).toEqual({ parentChain: "chains/123", childrenLocations: [child] })
})

it("removes one proposed child and omits the final empty relationship object", () => {
  expect(removeOnboardingRelationship({ parentLocation: parent, childrenLocations: [child, second] }, { parent: false, placeId: child.placeId })).toEqual({ parentLocation: parent, childrenLocations: [second] })
  expect(removeOnboardingRelationship({ childrenLocations: [child] }, { parent: false, placeId: child.placeId })).toBeUndefined()
  expect(removeOnboardingRelationship({ parentLocation: parent }, { parent: true })).toBeUndefined()
})

it("reviews exact IDs and readable relationship types without inferring a chain", () => {
  const rows = onboardingRelationshipReviewRows({ parentLocation: parent, childrenLocations: [child, second] })
  expect(rows).toContainEqual({ label: "Parent business place ID", value: parent.placeId })
  expect(rows).toContainEqual({ label: "Relationship to parent", value: "Department" })
  expect(rows).toContainEqual({ label: "Child 1 place ID", value: child.placeId })
  expect(rows).toContainEqual({ label: "Child 1 relationship", value: "Independent business at the same address" })
  expect(rows).toContainEqual({ label: "Child 2 place ID", value: second.placeId })
  expect(rows.some((row) => row.label === "Chain affiliation")).toBe(false)
})
