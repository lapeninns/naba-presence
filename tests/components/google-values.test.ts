import { describe, expect, it } from "vitest"

import {
  buildAttributesUpdate,
  buildLocationUpdate,
  draftFromLocation,
  fieldErrorsFromPayload,
  presentUnsupportedLeaves,
} from "@/lib/locations/business-information-draft"
import {
  asArray,
  asRecord,
  asString,
  asStringArray,
  attributesFromState,
  describeAttributeValue,
  enumOptionsFor,
  extractCategories,
  groupByLabel,
  isPresent,
  locationDiffRows,
  toCategoryRef,
} from "@/lib/locations/google-values"

describe("google-values leaf readers", () => {
  it("reads records defensively, with {} / [] / '' on a miss", () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 })
    expect(asRecord(null)).toEqual({})
    expect(asRecord([1])).toEqual({})
    expect(asRecord("x")).toEqual({})
    expect(asArray([{ a: 1 }, null, "x"])).toEqual([{ a: 1 }, {}, {}])
    expect(asArray("nope")).toEqual([])
    expect(asString("hi")).toBe("hi")
    expect(asString(3)).toBe("")
    expect(asStringArray(["a", 1, "b", null])).toEqual(["a", "b"])
    expect(asStringArray({})).toEqual([])
  })

  it("treats empty containers and null as absent", () => {
    expect(isPresent(null)).toBe(false)
    expect(isPresent(undefined)).toBe(false)
    expect(isPresent([])).toBe(false)
    expect(isPresent({})).toBe(false)
    expect(isPresent(0)).toBe(true)
    expect(isPresent("")).toBe(true)
    expect(isPresent([{ foo: 1 }])).toBe(true)
  })

  it("reads category refs and Google category search results", () => {
    expect(
      toCategoryRef({ name: "categories/gcid:hotel", displayName: "Hotel" })
    ).toEqual({
      name: "categories/gcid:hotel",
      displayName: "Hotel",
    })
    expect(toCategoryRef({ name: "categories/gcid:hotel" })).toEqual({
      name: "categories/gcid:hotel",
      displayName: null,
    })
    expect(toCategoryRef({ displayName: "no name" })).toBeNull()
    expect(toCategoryRef(null)).toBeNull()
    expect(
      extractCategories({
        categories: [
          { name: "categories/gcid:spa", displayName: "Spa" },
          { junk: true },
        ],
      })
    ).toEqual([{ name: "categories/gcid:spa", displayName: "Spa" }])
    expect(extractCategories(undefined)).toEqual([])
  })

  it("groups in first-seen order", () => {
    const grouped = groupByLabel(
      [
        { g: "B", n: 1 },
        { g: "A", n: 2 },
        { g: "B", n: 3 },
      ],
      (item) => item.g
    )
    expect(grouped).toEqual([
      [
        "B",
        [
          { g: "B", n: 1 },
          { g: "B", n: 3 },
        ],
      ],
      ["A", [{ g: "A", n: 2 }]],
    ])
  })
})

describe("google-values attributes", () => {
  const enumMeta = {
    parent: "attributes/wheelchair",
    displayName: "Wheelchair access",
    valueType: "ENUM",
    valueMetadata: [
      { value: "FULL", displayName: "Full access" },
      { value: "PARTIAL" },
      { displayName: "no value" },
    ],
  }

  it("reads enum options from valueMetadata, labelling by displayName", () => {
    expect(enumOptionsFor(enumMeta)).toEqual([
      { value: "FULL", label: "Full access" },
      { value: "PARTIAL", label: "PARTIAL" },
    ])
    expect(enumOptionsFor({ parent: "attributes/x" })).toEqual([])
  })

  it("humanises every editable value type for the publish diff", () => {
    const bool = { parent: "attributes/wifi", valueType: "BOOL" }
    expect(
      describeAttributeValue(bool, { name: "attributes/wifi", values: [true] })
    ).toBe("Yes")
    expect(describeAttributeValue(bool, undefined)).toBe("No")
    expect(
      describeAttributeValue(enumMeta, {
        name: enumMeta.parent,
        repeatedEnumValue: { setValues: ["FULL"] },
      })
    ).toBe("Full access")
    expect(describeAttributeValue(enumMeta, undefined)).toBe("Not set")
    const url = { parent: "attributes/url_menu", valueType: "URL" }
    expect(
      describeAttributeValue(url, {
        name: url.parent,
        uriValues: [{ uri: "https://menu.test" }],
      })
    ).toBe("https://menu.test")
    expect(describeAttributeValue(url, undefined)).toBe("Not set")
    expect(
      describeAttributeValue(
        { parent: "x", valueType: "PHOTOS_LIST" },
        undefined
      )
    ).toBeNull()
    expect(describeAttributeValue(undefined, undefined)).toBeNull()
  })

  it("narrows the raw attributes resource to the typed shape for known metadata only", () => {
    const map = attributesFromState(
      {
        name: "locations/l/attributes",
        attributes: [
          { name: "attributes/wifi", values: [true] },
          {
            name: "attributes/url_menu",
            uriValues: [
              { uri: "https://m.test", uriType: "MENU" },
              { nope: 1 },
            ],
          },
          {
            name: "attributes/wheelchair",
            repeatedEnumValue: { setValues: ["FULL"], unsetValues: [3] },
          },
          { name: "attributes/unknown", values: [1] },
        ],
      },
      [
        { parent: "attributes/wifi", valueType: "BOOL" },
        { parent: "attributes/url_menu", valueType: "URL" },
        { parent: "attributes/wheelchair", valueType: "ENUM" },
        { parent: "attributes/missing", valueType: "BOOL" },
      ]
    )
    expect(map).toEqual({
      "attributes/wifi": {
        name: "attributes/wifi",
        values: [true],
        uriValues: undefined,
        repeatedEnumValue: undefined,
      },
      "attributes/url_menu": {
        name: "attributes/url_menu",
        values: undefined,
        uriValues: [{ uri: "https://m.test", uriType: "MENU" }],
        repeatedEnumValue: undefined,
      },
      "attributes/wheelchair": {
        name: "attributes/wheelchair",
        values: undefined,
        uriValues: undefined,
        repeatedEnumValue: { setValues: ["FULL"], unsetValues: [] },
      },
    })
  })
})

describe("business-information draft", () => {
  const location = {
    title: "Camden Hotel",
    profile: { description: "A calm stay" },
    phoneNumbers: { primaryPhone: "+44 20 7946 0000" },
    websiteUri: "https://camden.test",
    storeCode: "CAMDEN-1",
    openInfo: { status: "CLOSED_TEMPORARILY" },
    labels: ["hotel", 3],
    categories: {
      primaryCategory: { name: "categories/gcid:hotel", displayName: "Hotel" },
      additionalCategories: [{ name: "categories/gcid:spa" }, { bogus: true }],
    },
    storefrontAddress: {
      addressLines: ["10 High St"],
      locality: "London",
      postalCode: "NW1",
    },
    serviceItems: [{ foo: 1 }],
    serviceArea: {},
  }

  it("projects the raw Google location onto the draft with GB/OPEN defaults", () => {
    expect(draftFromLocation(location)).toEqual({
      title: "Camden Hotel",
      description: "A calm stay",
      primaryPhone: "+44 20 7946 0000",
      websiteUri: "https://camden.test",
      openStatus: "CLOSED_TEMPORARILY",
      storeCode: "CAMDEN-1",
      labels: ["hotel"],
      primaryCategory: { name: "categories/gcid:hotel", displayName: "Hotel" },
      additionalCategories: [
        { name: "categories/gcid:spa", displayName: null },
      ],
      addressLines: ["10 High St"],
      locality: "London",
      postalCode: "NW1",
      regionCode: "GB",
    })
    expect(draftFromLocation({})).toMatchObject({
      openStatus: "OPEN",
      regionCode: "GB",
      labels: [],
    })
  })

  it("lists only the unsupported leaves Google actually holds", () => {
    expect(presentUnsupportedLeaves(location).map((l) => l.key)).toEqual([
      "serviceItems",
    ])
    expect(presentUnsupportedLeaves({})).toEqual([])
  })

  it("masks only the touched fields and never emits categories without a primary", () => {
    const initial = draftFromLocation(location)
    expect(buildLocationUpdate(initial, initial)).toEqual({
      updateMask: [],
      payload: {},
    })

    const touched = {
      ...initial,
      title: "Camden Boutique Hotel",
      locality: "Camden",
    }
    const update = buildLocationUpdate(initial, touched)
    expect(update.updateMask).toEqual(["title", "storefrontAddress"])
    expect(update.payload).toEqual({
      title: "Camden Boutique Hotel",
      storefrontAddress: {
        regionCode: "GB",
        addressLines: ["10 High St"],
        locality: "Camden",
        postalCode: "NW1",
      },
    })

    const noPrimary = { ...initial, primaryCategory: null }
    const extra = {
      ...noPrimary,
      additionalCategories: [
        ...noPrimary.additionalCategories,
        { name: "categories/gcid:pool" },
      ],
    }
    expect(buildLocationUpdate(noPrimary, extra).updateMask).toEqual([])
  })

  it("diffs the mask with humanised values", () => {
    const initial = draftFromLocation(location)
    const draft = {
      ...initial,
      openStatus: "OPEN",
      labels: [] as string[],
      primaryCategory: null,
    }
    const rows = locationDiffRows(
      ["openInfo", "labels", "categories"],
      initial,
      draft
    )
    expect(rows).toEqual([
      {
        key: "openInfo",
        label: "Open status",
        currentValue: "Temporarily closed",
        nextValue: "Open",
      },
      {
        key: "labels",
        label: "Labels",
        currentValue: "hotel",
        nextValue: null,
      },
      {
        key: "categories",
        label: "Categories",
        currentValue: "Hotel, Spa",
        nextValue: "Spa",
      },
    ])
    expect(rows.some((row) => /gcid:/.test(row.currentValue ?? ""))).toBe(false)
  })

  it("masks changed attributes and surfaces schema issues as field copy", () => {
    const meta = [{ parent: "attributes/wifi" }, { parent: "attributes/pets" }]
    const initial = {
      "attributes/wifi": { name: "attributes/wifi", values: [false] },
    }
    const draft = {
      "attributes/wifi": { name: "attributes/wifi", values: [true] },
      "attributes/pets": { name: "attributes/pets", values: [true] },
    }
    expect(buildAttributesUpdate(meta, initial, draft)).toEqual({
      attributeMask: ["attributes/wifi", "attributes/pets"],
      attributes: [draft["attributes/wifi"], draft["attributes/pets"]],
    })
    expect(fieldErrorsFromPayload({})).toEqual({})
    const errors = fieldErrorsFromPayload({ title: "" })
    expect(typeof errors.title).toBe("string")
    expect(errors.title).not.toMatch(/\{|\}/)
  })
})
