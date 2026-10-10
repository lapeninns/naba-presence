import { expect, it } from "vitest"
import { googleRelationshipSchema, relationshipsMatch, unsupportedRelationshipBaseline } from "@/lib/domain/google-relationships"
import { assertBusinessInformationMask, businessInformationPayloadSchema } from "@/lib/domain/business-information"

const parent = { placeId: "ChIJ_parent", relationType: "DEPARTMENT_OF" as const }
const child = { placeId: "ChIJ_child", relationType: "INDEPENDENT_ESTABLISHMENT_IN" as const }

it("accepts typed relationships and explicit field-specific clears", () => {
  for (const relationshipData of [{ parentChain: "chains/123" }, { parentChain: "" }, { parentLocation: parent }, { parentLocation: {} }, { childrenLocations: [child] }, { childrenLocations: [] }]) {
    expect(businessInformationPayloadSchema.safeParse({ relationshipData }).success).toBe(true)
    expect(() => assertBusinessInformationMask({ relationshipData }, [`relationshipData.${Object.keys(relationshipData)[0]}`])).not.toThrow()
  }
  expect(() => assertBusinessInformationMask({ relationshipData: {} }, ["relationshipData.parentChain"])).toThrow()
})

it("rejects malformed resources, unsupported relation types and duplicate children", () => {
  for (const value of [{ parentChain: "arbitrary" }, { parentChain: "chains/a/b" }, { parentLocation: { ...parent, relationType: "UNKNOWN" } }, { parentLocation: { ...parent, placeId: "a b" } }, { childrenLocations: [child, child] }, { futureField: true }]) expect(googleRelationshipSchema.safeParse(value).success).toBe(false)
})

it("confirms only selected relationships and recognises omitted cleared fields", () => {
  expect(relationshipsMatch({ parentChain: "chains/123", futureField: true, parentLocation: parent }, { parentChain: "chains/123" }, "relationshipData.parentChain")).toBe(true)
  expect(relationshipsMatch({ parentLocation: parent }, { parentChain: "" }, "relationshipData.parentChain")).toBe(true)
  expect(relationshipsMatch({ parentChain: "chains/123" }, { parentChain: "" }, "relationshipData.parentChain")).toBe(false)
  expect(relationshipsMatch({}, { parentLocation: {} }, "relationshipData.parentLocation")).toBe(true)
  expect(relationshipsMatch({ parentLocation: parent }, { parentLocation: {} }, "relationshipData.parentLocation")).toBe(false)
  expect(relationshipsMatch({ parentLocation: { ...parent, relationType: "INDEPENDENT_ESTABLISHMENT_IN" } }, { parentLocation: parent }, "relationshipData.parentLocation")).toBe(false)
  expect(relationshipsMatch({ parentChain: "chains/123" }, {}, "relationshipData")).toBe(false)
})

it("compares complete child collections without depending on provider ordering", () => {
  expect(relationshipsMatch({ childrenLocations: [child, parent] }, { childrenLocations: [parent, child] }, "relationshipData.childrenLocations")).toBe(true)
  expect(relationshipsMatch({ childrenLocations: [child, child] }, { childrenLocations: [child] }, "relationshipData.childrenLocations")).toBe(false)
  expect(relationshipsMatch({ childrenLocations: [child] }, { childrenLocations: [] }, "relationshipData.childrenLocations")).toBe(false)
  expect(relationshipsMatch({}, { childrenLocations: [] }, "relationshipData.childrenLocations")).toBe(true)
  expect(relationshipsMatch({ childrenLocations: null }, { childrenLocations: [] }, "relationshipData.childrenLocations")).toBe(false)
})

it("preserves unknown siblings through leaf masks and refuses unsupported selected parents", () => {
  const unknown = { parentChain: "chains/123", parentLocation: { ...parent, futureField: true }, futureField: "preserve" }
  expect(unsupportedRelationshipBaseline(unknown, ["relationshipData.parentChain"])).toBe(false)
  expect(unsupportedRelationshipBaseline(unknown, ["relationshipData.parentLocation"])).toBe(true)
  expect(unsupportedRelationshipBaseline(unknown, ["relationshipData"])).toBe(true)
  expect(unsupportedRelationshipBaseline(unknown, ["title"])).toBe(false)
  expect(unsupportedRelationshipBaseline(undefined, ["relationshipData.parentChain"])).toBe(false)
})
