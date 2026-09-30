import { describe, expect, it } from "vitest"
import { googleAttributesMatch, unsupportedAttributeNames } from "@/lib/domain/google-attributes"
import { businessInformationAttributeUpdateSchema } from "@/lib/contracts/location-business-information"

const name = "attributes/wifi"
const mask = [name]
const update = { operation: "update_attributes", confirmation: "publish_business_attributes_to_google", expectedGoogleHash: "a".repeat(64), attributeMask: mask }
describe("current attribute metadata", () => {
  it("requires one current non-deprecated definition even for clears", () => {
    expect(unsupportedAttributeNames([], [], mask)).toEqual(mask)
    expect(unsupportedAttributeNames([{ parent: name, valueType: "BOOL", deprecated: true }], [], mask)).toEqual(mask)
    expect(unsupportedAttributeNames([{ parent: name, valueType: "BOOL" }], [], mask)).toEqual([])
  })
  it("checks boolean and enum values against their actual type and allowed choices", () => {
    expect(unsupportedAttributeNames([{ parent: name, valueType: "BOOL" }], [{ name, values: [false] }], mask)).toEqual([])
    expect(unsupportedAttributeNames([{ parent: name, valueType: "BOOL" }], [{ name, values: ["false"] }], mask)).toEqual(mask)
    const metadata = [{ parent: name, valueType: "ENUM", valueMetadata: [{ value: "FULL" }] }]
    expect(unsupportedAttributeNames(metadata, [{ name, values: ["FULL"] }], mask)).toEqual([])
    expect(unsupportedAttributeNames(metadata, [{ name, values: ["UNKNOWN"] }], mask)).toEqual(mask)
  })
  it("validates unset enum answers and URL multiplicity", () => {
    expect(unsupportedAttributeNames([{ parent: name, valueType: "REPEATED_ENUM", valueMetadata: [{ value: "A" }] }], [{ name, repeatedEnumValue: { unsetValues: ["B"] } }], mask)).toEqual(mask)
    const values = [{ name, uriValues: [{ uri: "https://example.com/1" }, { uri: "https://example.com/2" }] }]
    expect(unsupportedAttributeNames([{ parent: name, valueType: "URL" }], values, mask)).toEqual(mask)
    expect(unsupportedAttributeNames([{ parent: name, valueType: "URL", repeatable: true }], values, mask)).toEqual([])
  })
})
describe("attribute write boundaries", () => {
  it.each([
    [], [{ name, values: [false] }], [{ name, values: ["FULL"] }],
    [{ name, uriValues: [{ uri: "https://example.com" }] }],
    [{ name, repeatedEnumValue: { setValues: ["A"], unsetValues: ["B"] } }],
  ].map((attributes) => ({ attributes })))("accepts explicit answers and masked deletion: $attributes", ({ attributes }) => {
    expect(businessInformationAttributeUpdateSchema.safeParse({ ...update, attributes }).success).toBe(true)
  })
  it.each([
    [{ name }], [{ name, values: [] }], [{ name, values: [true, false] }],
    [{ name, values: [{}] }], [{ name, uriValues: [] }],
    [{ name, values: [true], uriValues: [{ uri: "https://example.com" }] }],
    [{ name, repeatedEnumValue: {} }],
    [{ name, repeatedEnumValue: { setValues: ["A", "A"] } }],
    [{ name, repeatedEnumValue: { setValues: ["A"], unsetValues: ["A"] } }],
    [{ name, values: [true] }, { name, values: [false] }],
    [{ name: "attributes/other", values: [true] }],
  ].map((attributes) => ({ attributes })))("rejects conflicting or unreviewed attribute values: $attributes", ({ attributes }) => {
    expect(businessInformationAttributeUpdateSchema.safeParse({ ...update, attributes }).success).toBe(false)
  })
  it.each([[name, name], ["wifi"], ["attributes/one,attributes/two"], ["attributes/a/b"], []].map((attributeMask) => ({ attributeMask })))("rejects invalid masks: $attributeMask", ({ attributeMask }) => {
    expect(businessInformationAttributeUpdateSchema.safeParse({ ...update, attributeMask, attributes: [] }).success).toBe(false)
  })
})
describe("Google attribute readback", () => {
  it("requires the requested boolean, preserving false versus absent", () => {
    expect(googleAttributesMatch({ attributes: [{ name, values: [false], valueType: "BOOL" }] }, [{ name, values: [false] }], mask)).toBe(true)
    expect(googleAttributesMatch({}, [{ name, values: [false] }], mask)).toBe(false)
    expect(googleAttributesMatch({ attributes: [{ name, values: [true] }] }, [{ name, values: [false] }], mask)).toBe(false)
  })
  it("confirms a clear only when the masked attribute is absent", () => {
    expect(googleAttributesMatch({}, [], mask)).toBe(true)
    expect(googleAttributesMatch({ attributes: [{ name, values: [false] }] }, [], mask)).toBe(false)
    expect(googleAttributesMatch({ attributes: [{ name }] }, [], mask)).toBe(false)
  })
  it("ignores unrelated attributes and provider output fields", () => {
    expect(googleAttributesMatch({ attributes: [{ name, values: ["FULL"], valueType: "ENUM" }, { name: "attributes/other", values: [true] }] }, [{ name, values: ["FULL"] }], mask)).toBe(true)
  })
  it("compares repeated enum answers without confusing set, unset and unknown", () => {
    const expected = [{ name, repeatedEnumValue: { setValues: ["A", "B"], unsetValues: ["C"] } }]
    expect(googleAttributesMatch({ attributes: [{ name, repeatedEnumValue: { setValues: ["B", "A"], unsetValues: ["C"] } }] }, expected, mask)).toBe(true)
    expect(googleAttributesMatch({ attributes: [{ name, repeatedEnumValue: { setValues: ["B", "A", "C"] } }] }, expected, mask)).toBe(false)
  })
  it("detects retained or changed URLs", () => {
    const expected = [{ name, uriValues: [{ uri: "https://example.com/new" }] }]
    expect(googleAttributesMatch({ attributes: expected }, expected, mask)).toBe(true)
    expect(googleAttributesMatch({ attributes: [{ name, uriValues: [{ uri: "https://example.com/old" }] }] }, expected, mask)).toBe(false)
  })
  it("rejects malformed and duplicated evidence", () => {
    const answer = { name, values: [false] }
    expect(googleAttributesMatch({ attributes: [answer, answer] }, [answer], mask)).toBe(false)
    expect(googleAttributesMatch({ attributes: [answer] }, [answer, answer], mask)).toBe(false)
    expect(googleAttributesMatch({ attributes: null }, [], mask)).toBe(false)
    expect(googleAttributesMatch({}, [], [])).toBe(false)
    expect(googleAttributesMatch({}, [], [name, name])).toBe(false)
  })
})
