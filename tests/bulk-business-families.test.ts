import { describe, expect, it } from "vitest"

import { describeChildChange } from "@/components/bulk/bulk-change-summary"
import { bulkPreviewRequestSchema } from "@/lib/contracts/bulk-listings"
import {
  BULK_BUSINESS_INFO_FIELDS,
  businessInfoApplied,
  businessInfoCurrent,
  businessInfoPatch,
  businessInfoProposed,
  categoriesPayload,
  categoryIds,
  mergeCategories,
  sameCategories,
} from "@/lib/domain/bulk-business-info"
import {
  bulkLodgingPathAllowed,
  lodgingApplied,
  lodgingCurrent,
  lodgingSendBody,
} from "@/lib/domain/bulk-lodging"
import {
  BULK_PREREQUISITES,
  bulkChangeListSchema,
  bulkChangeParts,
  bulkListingOrder,
  bulkOperationInputSchema,
  bulkResourceKey,
} from "@/lib/domain/bulk-merge"
import { googleAttributeMetadataRequest } from "@/lib/domain/google-contract"
import { GOOGLE_LOCATION_FIELDS } from "@/lib/domain/google-capabilities"
import { GOOGLE_LODGING_BOOLEAN_PATHS } from "@/lib/domain/google-lodging"
import { lodgingNotFound } from "@/lib/server/bulk-families/industry"
import { planReads } from "@/lib/server/bulk-families/shared"
import { ApiError } from "@/lib/server/http"

const parse = (value: Record<string, unknown>) =>
  bulkOperationInputSchema.safeParse(value)
const info = (changes: unknown[]) => {
  const parsed = bulkOperationInputSchema.parse({
    operation: "business_info",
    changes,
  })
  if (parsed.operation !== "business_info") throw new Error("parse")
  return parsed
}
const categories = (value: Record<string, unknown>) => {
  const parsed = bulkOperationInputSchema.parse({
    operation: "categories",
    ...value,
  })
  if (parsed.operation !== "categories") throw new Error("parse")
  return parsed
}
const lodging = (value: Record<string, unknown>) =>
  bulkOperationInputSchema.safeParse({ operation: "lodging", ...value })

describe("bulk business information (P09-R5)", () => {
  it("offers only fields Google lets a client write", () => {
    for (const { mask } of Object.values(BULK_BUSINESS_INFO_FIELDS))
      expect(
        GOOGLE_LOCATION_FIELDS[mask as keyof typeof GOOGLE_LOCATION_FIELDS]
          .support
      ).toBe("supported")
  })

  it("refuses provider-owned and per-listing fields, and clears that cannot be", () => {
    for (const field of [
      "name",
      "metadata",
      "latlng",
      "openInfo.canReopen",
      "title",
      "storefrontAddress",
      "phoneNumbers",
      "serviceItems",
      "categories",
    ])
      expect(
        parse({
          operation: "business_info",
          changes: [{ field, action: "set", value: "x" }],
        }).success,
        field
      ).toBe(false)
    expect(
      parse({
        operation: "business_info",
        changes: [{ field: "openInfo.status", action: "clear" }],
      }).success
    ).toBe(false)
    // Permanent closure is never a bulk change.
    expect(
      parse({
        operation: "business_info",
        changes: [
          {
            field: "openInfo.status",
            action: "set",
            value: "CLOSED_PERMANENTLY",
          },
        ],
      }).success
    ).toBe(false)
    expect(
      parse({
        operation: "business_info",
        changes: [
          { field: "websiteUri", action: "set", value: "javascript:alert(1)" },
        ],
      }).success
    ).toBe(false)
    expect(
      parse({
        operation: "business_info",
        changes: [
          { field: "websiteUri", action: "clear" },
          { field: "websiteUri", action: "set", value: "https://a.example" },
        ],
      }).success
    ).toBe(false)
  })

  it("patches only the named fields; a clear is in the mask and absent from the body", () => {
    const input = info([
      { field: "websiteUri", action: "clear" },
      { field: "profile.description", action: "set", value: "New words" },
      { field: "openInfo.status", action: "set", value: "CLOSED_TEMPORARILY" },
    ])
    expect(businessInfoPatch(input)).toEqual({
      updateMask: ["openInfo.status", "profile", "websiteUri"],
      payload: {
        profile: { description: "New words" },
        openInfo: { status: "CLOSED_TEMPORARILY" },
      },
    })
    expect(businessInfoProposed(input)).toEqual({
      "openInfo.status": "CLOSED_TEMPORARILY",
      "profile.description": "New words",
      websiteUri: null,
    })
  })

  it("freezes and compares only the changed fields, the way Google echoes them", () => {
    const input = info([
      { field: "websiteUri", action: "set", value: "https://Pub.example/" },
      { field: "labels", action: "clear" },
    ])
    const location = {
      title: "Anything",
      websiteUri: "https://old.example",
      labels: ["a"],
    }
    expect(businessInfoCurrent(input, location)).toEqual({
      labels: ["a"],
      websiteUri: "https://old.example",
    })
    expect(businessInfoApplied(location, input.changes)).toBe(false)
    expect(
      businessInfoApplied(
        { title: "Changed", websiteUri: "https://pub.example" },
        input.changes
      )
    ).toBe(true)
    expect(
      businessInfoApplied(
        { websiteUri: "https://pub.example", labels: [] },
        input.changes
      )
    ).toBe(true)
  })

  it("serialises business information and categories under the editor's key", () => {
    expect(bulkResourceKey("business_info")).toBe("business_info")
    expect(bulkResourceKey("categories")).toBe("business_info")
    expect(bulkResourceKey("lodging")).toBe("lodging")
  })
})

describe("bulk categories (P09-R5)", () => {
  it("validates stable IDs and refuses contradictions", () => {
    expect(parse({ operation: "categories" }).success).toBe(false)
    expect(
      parse({ operation: "categories", primaryCategory: "Pub" }).success
    ).toBe(false)
    expect(
      parse({
        operation: "categories",
        addAdditional: ["categories/gcid:bar"],
        removeAdditional: ["categories/gcid:bar"],
      }).success
    ).toBe(false)
    expect(
      parse({
        operation: "categories",
        primaryCategory: "categories/gcid:pub",
        addAdditional: ["categories/gcid:pub"],
      }).success
    ).toBe(false)
  })

  it("merges by ID, keeping additional categories the change does not name", () => {
    const current = categoryIds({
      categories: {
        primaryCategory: { name: "categories/gcid:pub", displayName: "Pub" },
        additionalCategories: [
          { name: "categories/gcid:restaurant" },
          { name: "categories/gcid:bar" },
        ],
      },
    })
    expect(current).toEqual({
      primary: "categories/gcid:pub",
      additional: ["categories/gcid:bar", "categories/gcid:restaurant"],
    })
    const merged = mergeCategories(
      categories({
        primaryCategory: "categories/gcid:gastropub",
        addAdditional: ["categories/gcid:beer_garden"],
        removeAdditional: ["categories/gcid:bar"],
      }),
      current
    )
    expect(merged).toEqual({
      ok: true,
      categories: {
        primary: "categories/gcid:gastropub",
        additional: [
          "categories/gcid:beer_garden",
          "categories/gcid:restaurant",
        ],
      },
    })
    // Promoting an additional category drops it from the additional list.
    expect(
      mergeCategories(
        categories({ primaryCategory: "categories/gcid:bar" }),
        current
      )
    ).toEqual({
      ok: true,
      categories: {
        primary: "categories/gcid:bar",
        additional: ["categories/gcid:restaurant"],
      },
    })
    const full = {
      primary: "categories/gcid:pub",
      additional: Array.from({ length: 9 }, (_, i) => `categories/gcid:c${i}`),
    }
    expect(
      mergeCategories(
        categories({ addAdditional: ["categories/gcid:extra"] }),
        full
      )
    ).toEqual({ ok: false, reason: "too_many_categories" })
    expect(
      mergeCategories(categories({ addAdditional: ["categories/gcid:x"] }), {
        primary: null,
        additional: [],
      })
    ).toEqual({ ok: false, reason: "category_missing" })
  })

  it("compares categories as sets and sends names only", () => {
    expect(
      sameCategories(
        {
          primary: "categories/gcid:a",
          additional: ["categories/gcid:c", "categories/gcid:b"],
        },
        {
          primary: "categories/gcid:a",
          additional: ["categories/gcid:b", "categories/gcid:c"],
        }
      )
    ).toBe(true)
    expect(
      categoriesPayload({
        primary: "categories/gcid:a",
        additional: ["categories/gcid:b"],
      })
    ).toEqual({
      categories: {
        primaryCategory: { name: "categories/gcid:a" },
        additionalCategories: [{ name: "categories/gcid:b" }],
      },
    })
  })

  it("must precede the changes that depend on it, which require it to apply", () => {
    expect(BULK_PREREQUISITES).toEqual({
      more_hours: ["categories"],
      attributes: ["categories"],
    })
    const categoryChange = {
      operation: "categories",
      primaryCategory: "categories/gcid:pub",
    }
    const attributes = {
      operation: "attributes",
      changes: [{ name: "attributes/has_wifi", values: [true] }],
    }
    expect(
      bulkChangeListSchema.safeParse([attributes, categoryChange]).success
    ).toBe(false)
    expect(
      bulkChangeListSchema.safeParse([categoryChange, attributes]).success
    ).toBe(true)
    const order = bulkListingOrder([
      { operation: "categories", eligible: true },
      { operation: "business_info", eligible: true },
      { operation: "attributes", eligible: true },
    ])
    expect(order[2].requiresApplied).toEqual([0])
    expect(order[1].requiresApplied).toEqual([])
  })

  it("reads attribute metadata for a primary category in a region", () => {
    const request = googleAttributeMetadataRequest({
      categoryName: "categories/gcid:pub",
      regionCode: "GB",
      languageCode: "en",
    })
    const url = new URL(request.url)
    expect(url.searchParams.get("categoryName")).toBe("categories/gcid:pub")
    expect(url.searchParams.get("regionCode")).toBe("GB")
    expect(url.searchParams.has("parent")).toBe(false)
  })

  it("hands an earlier change's proposal to later plans at the listing", () => {
    const reads = planReads()
    expect(reads.proposed("categories")).toBeUndefined()
    const proposal = {
      primary: "categories/gcid:pub",
      moreHoursTypes: ["HAPPY_HOURS"],
    }
    reads.propose("categories", proposal)
    const seen = reads.proposed<typeof proposal>("categories")
    expect(seen).toEqual(proposal)
    seen?.moreHoursTypes.push("X")
    expect(
      reads.proposed<typeof proposal>("categories")?.moreHoursTypes
    ).toEqual(["HAPPY_HOURS"])
  })
})

describe("bulk lodging (P09-R5)", () => {
  it("takes only typed allowlist paths, never metadata or guest units", () => {
    expect(bulkLodgingPathAllowed("pools.pool")).toBe(true)
    expect(bulkLodgingPathAllowed("metadata.updateTime")).toBe(false)
    expect(bulkLodgingPathAllowed("metadata")).toBe(false)
    expect(bulkLodgingPathAllowed("guestUnits")).toBe(false)
    expect(bulkLodgingPathAllowed("name")).toBe(false)
    expect(bulkLodgingPathAllowed("allUnits")).toBe(false)
    expect(GOOGLE_LODGING_BOOLEAN_PATHS).toContain("pools.pool")
    expect(GOOGLE_LODGING_BOOLEAN_PATHS.every(bulkLodgingPathAllowed)).toBe(
      true
    )
  })

  it("needs a value or an explicit clear for every path, and nothing outside the mask", () => {
    expect(
      lodging({
        updateMask: ["pools.pool"],
        payload: { pools: { pool: false } },
      }).success
    ).toBe(true)
    expect(lodging({ updateMask: ["pools.pool"], payload: {} }).success).toBe(
      false
    )
    expect(
      lodging({
        updateMask: ["pools.pool"],
        clear: ["pools.pool"],
        payload: {},
      }).success
    ).toBe(true)
    expect(
      lodging({
        updateMask: ["pools.pool"],
        payload: { pools: { pool: true, wavePool: true } },
      }).success
    ).toBe(false)
    expect(
      lodging({
        updateMask: ["pools", "pools.pool"],
        payload: { pools: { pool: true } },
      }).success
    ).toBe(false)
    expect(
      lodging({
        updateMask: ["pools.pool"],
        payload: { pools: { pool: "yes" } },
      }).success
    ).toBe(false)
    expect(
      lodging({
        updateMask: ["metadata.updateTime"],
        payload: { metadata: { updateTime: "2026-01-01T00:00:00Z" } },
      }).success
    ).toBe(false)
  })

  it("keeps false distinct from unset, and stamps updateTime only at the send", () => {
    const parsed = bulkOperationInputSchema.parse({
      operation: "lodging",
      updateMask: ["pools.pool", "pools.wavePool"],
      clear: ["pools.wavePool"],
      payload: { pools: { pool: false } },
    })
    if (parsed.operation !== "lodging") throw new Error("parse")
    expect(lodgingApplied({ pools: {} }, parsed)).toBe(false)
    expect(lodgingApplied({ pools: { pool: false } }, parsed)).toBe(true)
    expect(
      lodgingApplied({ pools: { pool: false, wavePool: true } }, parsed)
    ).toBe(false)
    expect(lodgingCurrent(parsed, { pools: { pool: true } })).toEqual({
      "pools.pool": true,
      "pools.wavePool": null,
    })
    expect(bulkChangeParts(parsed)).toEqual(["lodging:pools"])
    const body = lodgingSendBody(parsed, new Date("2026-10-12T10:00:00Z"))
    expect(body.updateMask).toEqual([
      "metadata.updateTime",
      "pools.pool",
      "pools.wavePool",
    ])
    expect(body.payload.metadata).toEqual({
      updateTime: "2026-10-12T10:00:00.000Z",
    })
  })

  it("compares a group path exactly, so a sibling the write would clear is not applied", () => {
    const parsed = bulkOperationInputSchema.parse({
      operation: "lodging",
      updateMask: ["pools", "policies.checkinTime"],
      payload: {
        pools: { pool: true },
        policies: { checkinTime: { hours: 15 } },
      },
    })
    if (parsed.operation !== "lodging") throw new Error("parse")
    const time = { checkinTime: { hours: 15, minutes: 0 } }
    // The listing still holds hotTub: the same PATCH would clear it.
    expect(
      lodgingApplied(
        { pools: { pool: true, hotTub: true }, policies: time },
        parsed
      )
    ).toBe(false)
    // `false` is a value, so it is a sibling the write would clear too.
    expect(
      lodgingApplied(
        { pools: { pool: true, hotTub: false }, policies: time },
        parsed
      )
    ).toBe(false)
    expect(
      lodgingApplied({ pools: { pool: true }, policies: time }, parsed)
    ).toBe(true)
    // Fields a client cannot write are ignored, and a TimeOfDay is one value.
    expect(
      lodgingApplied(
        { pools: { pool: true, readOnlyEcho: 1 }, policies: time },
        parsed
      )
    ).toBe(true)
  })

  it("skips a listing for Google's missing lodging, never for a lost connection", () => {
    expect(lodgingNotFound(new ApiError(404, "NOT_FOUND", "No lodging."))).toBe(
      true
    )
    expect(
      lodgingNotFound(
        new ApiError(
          404,
          "connection_not_found",
          "Google connection not found."
        )
      )
    ).toBe(false)
    expect(lodgingNotFound(new ApiError(403, "PERMISSION_DENIED", "No."))).toBe(
      false
    )
  })

  it("has no healthcare family (pending D-24)", () => {
    expect(
      parse({
        operation: "healthcare_services",
        updateMask: ["x"],
        payload: {},
      }).success
    ).toBe(false)
  })
})

describe("bulk preview request with the new families", () => {
  it("accepts a mixed list with categories first", () => {
    expect(
      bulkPreviewRequestSchema.safeParse({
        locationIds: ["00000000-0000-4000-8000-000000000001"],
        items: [
          { operation: "categories", primaryCategory: "categories/gcid:pub" },
          {
            operation: "business_info",
            changes: [{ field: "websiteUri", action: "clear" }],
          },
          {
            operation: "lodging",
            updateMask: ["pools.pool"],
            payload: { pools: { pool: true } },
          },
        ],
      }).success
    ).toBe(true)
  })
})

describe("approver's view of the new families", () => {
  it("describes each field, a clear as Not set and false as No", () => {
    const base = { updateMask: [] as string[] }
    expect(
      describeChildChange({
        ...base,
        operation: "business_info",
        input: info([{ field: "websiteUri", action: "clear" }]),
        currentValue: { websiteUri: "https://a.example" },
        proposedValue: { websiteUri: null },
      })
    ).toEqual([
      { label: "Website", current: "https://a.example", proposed: "Not set" },
    ])
    expect(
      describeChildChange({
        ...base,
        operation: "categories",
        input: categories({ primaryCategory: "categories/gcid:gastropub" }),
        currentValue: { primary: "categories/gcid:pub", additional: [] },
        proposedValue: { primary: "categories/gcid:gastropub", additional: [] },
      })
    ).toEqual([
      { label: "Primary category", current: "Pub", proposed: "Gastropub" },
    ])
    const lodgingInput = bulkOperationInputSchema.parse({
      operation: "lodging",
      updateMask: ["pools.pool"],
      payload: { pools: { pool: false } },
    })
    expect(
      describeChildChange({
        ...base,
        operation: "lodging",
        input: lodgingInput,
        currentValue: { "pools.pool": null },
        proposedValue: { "pools.pool": false },
      })
    ).toEqual([{ label: "Pools › Pool", current: "Not set", proposed: "No" }])
  })
})
