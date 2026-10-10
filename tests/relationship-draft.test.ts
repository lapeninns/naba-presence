import { expect, it } from "vitest"
import { buildLocationUpdate, draftFromLocation } from "@/lib/locations/business-information-draft"
import { parseListingDraft } from "@/lib/locations/forms/listing-draft"
import { locationDiffRows } from "@/lib/locations/google-values"

const parent = { placeId: "ChIJ_parent", relationType: "DEPARTMENT_OF" as const }
const child = { placeId: "ChIJ_child", relationType: "INDEPENDENT_ESTABLISHMENT_IN" as const }
const relationshipData = { parentChain: "chains/123", parentLocation: parent, childrenLocations: [child] }

it("loads and restores exact relationship identifiers without inventing absent fields", () => {
  const initial = draftFromLocation({ relationshipData })
  expect(initial.relationshipData).toEqual(relationshipData)
  expect(parseListingDraft(initial)?.relationshipData).toEqual(relationshipData)
  expect(draftFromLocation({}).relationshipData).toBeUndefined()
  expect(buildLocationUpdate(initial, initial).updateMask).toEqual([])
})

it("changes chain affiliation without sending parent, child or unknown sibling fields", () => {
  const initial = draftFromLocation({ relationshipData: { ...relationshipData, parentLocation: { ...parent, futureField: true }, futureField: true } })
  expect(initial.relationshipData?.parentChain).toBe("chains/123")
  expect(initial.relationshipData?.childrenLocations).toEqual([child])
  expect(initial.relationshipData?.parentLocation).toBeUndefined()
  const next = { ...initial, relationshipData: { ...initial.relationshipData, parentChain: "chains/456" } }
  expect(buildLocationUpdate(initial, next)).toEqual({ updateMask: ["relationshipData.parentChain"], payload: { relationshipData: { parentChain: "chains/456" } } })
  expect(locationDiffRows(["relationshipData.parentChain"], initial, next)).toEqual([{ key: "relationshipData.parentChain", label: "Chain affiliation", currentValue: "chains/123", nextValue: "chains/456" }])
})

it("reviews and restores separate explicit relationship clears", () => {
  const initial = draftFromLocation({ relationshipData })
  const next = { ...initial, relationshipData: { parentChain: "", parentLocation: {}, childrenLocations: [] } }
  const update = buildLocationUpdate(initial, next)
  expect(update.updateMask).toEqual(["relationshipData.parentChain", "relationshipData.parentLocation", "relationshipData.childrenLocations"])
  expect(update.payload).toEqual({ relationshipData: next.relationshipData })
  expect(parseListingDraft(next)?.relationshipData).toEqual(next.relationshipData)
  const rows = locationDiffRows(update.updateMask, initial, next)
  expect(rows.map((row) => row.nextValue)).toEqual([null, null, null])
  expect(rows[1].currentValue).toBe("ChIJ_parent (Department)")
  expect(rows[2].currentValue).toBe("ChIJ_child (Independent business at the same address)")
})

it("does not publish empty controls on absent relationships or child reordering", () => {
  const empty = draftFromLocation({})
  expect(buildLocationUpdate(empty, { ...empty, relationshipData: { parentChain: "", parentLocation: {}, childrenLocations: [] } }).updateMask).toEqual([])
  const initial = draftFromLocation({ relationshipData: { childrenLocations: [parent, child] } })
  expect(buildLocationUpdate(initial, { ...initial, relationshipData: { childrenLocations: [child, parent] } }).updateMask).toEqual([])
})

it("includes relationship edits when storefront removal is reviewed together", () => {
  const initial = draftFromLocation({ relationshipData })
  const next = { ...initial, clearStorefrontAddress: true, relationshipData: { ...relationshipData, parentChain: "" } }
  expect(buildLocationUpdate(initial, next)).toEqual({ updateMask: ["relationshipData.parentChain", "storefrontAddress"], payload: { relationshipData: { parentChain: "" }, storefrontAddress: {} } })
})
