import { describe, expect, it } from "vitest"
import { businessInformationPatchSchema } from "@/lib/contracts/location-business-information"
import { googleServiceItemSchema, googleServiceItemsSchema, googleServicePriceSchema, serviceItemsMatch, unsupportedServiceIndexes } from "@/lib/domain/google-services"
import { googleCategoriesBatchRequest } from "@/lib/domain/google-contract"

const structured = { structuredServiceItem: { serviceTypeId: "job_type_id:repair", description: "Repair existing fittings" } }
const freeForm = { freeFormServiceItem: { category: "gcid:plumber", label: { displayName: "Emergency visit", description: "Evening visits", languageCode: "en-GB" } }, price: { currencyCode: "GBP", units: "75", nanos: 500000000 } }

describe("Google Business Information service contracts", () => {
  it("does not confirm clearing when Google retains a service price or description", () => {
    const cleared = { structuredServiceItem: { serviceTypeId: "job_type_id:repair" } }
    expect(serviceItemsMatch([structured], [cleared])).toBe(false)
    expect(serviceItemsMatch([{ ...cleared, price: { units: "0" } }], [cleared])).toBe(false)
    expect(serviceItemsMatch([cleared], [cleared])).toBe(true)
  })

  it("confirms reordered services while preserving duplicate counts and unknown state", () => {
    expect(serviceItemsMatch([freeForm, structured], [structured, freeForm])).toBe(true)
    expect(serviceItemsMatch([structured, structured], [structured, freeForm])).toBe(false)
    expect(serviceItemsMatch([{ ...structured, unknown: true }], [structured])).toBe(false)
    expect(serviceItemsMatch(undefined, [])).toBe(true)
    expect(serviceItemsMatch(null, [])).toBe(false)
    expect(serviceItemsMatch([structured], [])).toBe(false)
  })

  it("requests full metadata with repeated exact category IDs", () => {
    const request = googleCategoriesBatchRequest({ names: ["gcid:plumber", "gcid:electrician", "gcid:plumber"], languageCode: "en", regionCode: "GB" })
    const url = new URL(request.url)
    expect(url.pathname).toBe("/v1/categories:batchGet")
    expect(url.searchParams.getAll("names")).toEqual(["gcid:plumber", "gcid:electrician"])
    expect(url.searchParams.get("view")).toBe("FULL")
  })

  it("allows supported changes and preserves an unchanged legacy sibling", () => {
    const categories = [{ name: "categories/gcid:plumber", serviceTypes: [{ serviceTypeId: "job_type_id:repair" }] }]
    const legacy = { structuredServiceItem: { serviceTypeId: "legacy:service" } }
    expect(unsupportedServiceIndexes([structured, freeForm, legacy], [legacy], categories)).toEqual([])
    expect(unsupportedServiceIndexes([{ ...legacy, price: { units: "1" } }], [legacy], categories)).toEqual([0])
    expect(unsupportedServiceIndexes([legacy], [], categories)).toEqual([0])
    expect(unsupportedServiceIndexes([freeForm], [], [{ name: "gcid:hotel", serviceTypes: [] }])).toEqual([0])
  })
  it("preserves both service variants, optional fields and exact money strings", () => {
    expect(googleServiceItemsSchema.parse([structured, freeForm])).toEqual([structured, freeForm])
    expect(googleServiceItemSchema.parse({ structuredServiceItem: { serviceTypeId: "job_type_id:repair" } })).toEqual({ structuredServiceItem: { serviceTypeId: "job_type_id:repair" } })
    expect(googleServiceItemsSchema.parse([])).toEqual([])
  })

  it.each([
    {},
    { ...structured, ...freeForm },
    { structuredServiceItem: {} },
    { structuredServiceItem: { serviceTypeId: " " } },
    { structuredServiceItem: { serviceTypeId: "job_type_id:repair", description: "x".repeat(301) } },
    { freeFormServiceItem: { categoryId: "gcid:plumber", label: { displayName: "Visit" } } },
    { freeFormServiceItem: { category: "gcid:plumber", label: {} } },
    { ...structured, isOffered: false },
    { ...structured, unknownProviderField: "must not be silently dropped" },
  ])("rejects malformed or unsupported service payload %j", (value) => {
    expect(googleServiceItemSchema.safeParse(value).success).toBe(false)
  })

  it.each([
    { units: 75 }, { units: "1.5" }, { units: "9223372036854775808" },
    { units: "-9223372036854775809" }, { units: "1", nanos: -1 },
    { units: "-1", nanos: 1 }, { nanos: 1000000000 }, { nanos: 0.5 },
    { currencyCode: "gbp" },
  ])("rejects malformed money %j", (value) => {
    expect(googleServicePriceSchema.safeParse(value).success).toBe(false)
  })

  it("retains zero, absent price and valid int64 boundaries without rounding", () => {
    for (const price of [{ units: "0", nanos: 0 }, { units: "9223372036854775807" }, { units: "-9223372036854775808", nanos: -1 }, { nanos: -1 }]) {
      expect(googleServicePriceSchema.parse(price)).toEqual(price)
    }
  })

  it("enforces the service contract at the actual mutation boundary", () => {
    const request = { operation: "update_location", confirmation: "publish_business_information_to_google", expectedGoogleHash: "a".repeat(64), updateMask: ["serviceItems"], payload: { serviceItems: [structured, freeForm] } }
    expect(businessInformationPatchSchema.parse(request)).toEqual(request)
    expect(businessInformationPatchSchema.safeParse({ ...request, payload: { serviceItems: [{ arbitrary: true }] } }).success).toBe(false)
    expect(businessInformationPatchSchema.safeParse({ ...request, payload: { serviceItems: [freeForm, ...Array.from({ length: 100 }, () => structured)] } }).success).toBe(false)
  })
})
