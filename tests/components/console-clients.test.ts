import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiClientError } from "@/lib/api/client"
import {
  fetchBusinessInformation,
  fetchBusinessInformationMetadata,
  publishBusinessInformation,
} from "@/lib/api/location-business-information"
import { fetchIndustry, publishIndustry } from "@/lib/api/location-industry"
import {
  ADMINISTRATION_CONFIRMATIONS,
  DANGER_ZONE_OPERATIONS,
  runAdministrationOperation,
} from "@/lib/api/location-administration"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const BUSINESS = {
  businessInformation: {
    location: { title: "Camden Hotel", storeCode: "CAMDEN-1", labels: ["hotel"], openInfo: { status: "OPEN" }, categories: { primaryCategory: { name: "categories/gcid:hotel", displayName: "Hotel" } } },
    attributes: { name: "locations/camden/attributes", attributes: [{ name: "attributes/wifi", values: [true] }] },
    attributeMetadata: [{ parent: "attributes/wifi", displayName: "Wi-Fi", groupDisplayName: "Amenities", valueType: "BOOL" }],
    locationHash: "a".repeat(64), attributesHash: "b".repeat(64), canPublish: true, writesEnabled: true,
  },
}

describe("fetchBusinessInformation", () => {
  it("parses the envelope, preserves the raw Google location, and keeps both hashes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(BUSINESS)))
    const state = await fetchBusinessInformation("loc-1")
    expect(state.location.title).toBe("Camden Hotel")
    expect(state.attributeMetadata[0].valueType).toBe("BOOL")
    expect(state.locationHash).toHaveLength(64)
    expect(state.writesEnabled).toBe(true)
  })
})

describe("publishBusinessInformation", () => {
  it("PATCHes update_location with the confirmation literal, mask, payload, and hash", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ id: "m1", status: "succeeded", idempotent: false }))
    vi.stubGlobal("fetch", fetchMock)
    await publishBusinessInformation("loc-1", {
      updateMask: ["title"],
      payload: { title: "New name" },
      expectedGoogleHash: "a".repeat(64),
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/locations/loc-1/business-information")
    expect(init.method).toBe("PATCH")
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({
      operation: "update_location",
      confirmation: "publish_business_information_to_google",
      expectedGoogleHash: "a".repeat(64),
      updateMask: ["title"],
      payload: { title: "New name" },
    })
  })
  it("rethrows a 409 business_information_stale as ApiClientError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "business_information_stale", message: "stale" }, 409)))
    await expect(publishBusinessInformation("loc-1", { updateMask: ["title"], payload: { title: "x" }, expectedGoogleHash: "a".repeat(64) }))
      .rejects.toMatchObject({ constructor: ApiClientError, status: 409, code: "business_information_stale" })
  })
})

describe("fetchBusinessInformationMetadata", () => {
  it("forwards type/query/region/language and returns the raw result", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ result: { categories: [{ name: "categories/gcid:hotel", displayName: "Hotel" }] } }))
    vi.stubGlobal("fetch", fetchMock)
    const out = await fetchBusinessInformationMetadata("loc-1", { type: "categories", query: "hot" })
    const url = new URL(fetchMock.mock.calls[0][0] as string, "http://t")
    expect(url.searchParams.get("type")).toBe("categories")
    expect(url.searchParams.get("query")).toBe("hot")
    expect(url.searchParams.get("regionCode")).toBe("GB")
    expect(out.result).toMatchObject({ categories: [{ displayName: "Hotel" }] })
  })
})

describe("fetchIndustry / publishIndustry", () => {
  it("parses each sub-resource {data,error} envelope", async () => {
    const available = (data: unknown) => ({ data, error: null })
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ industry: {
      lodging: available({ policies: { checkinTime: "15:00" } }), lodgingUpdated: available({}), calls: available({ callsState: "ENABLED" }),
      callInsights: available({}), healthcareServices: available({}), providerAttributes: available({}), insuranceNetworks: available({}),
      canManage: true, writesEnabled: true,
    } })))
    const state = await fetchIndustry("loc-1")
    expect((state.calls.data as { callsState: string }).callsState).toBe("ENABLED")
    expect(state.calls.error).toBeNull()
    expect(state.canManage).toBe(true)
  })
  it("publishIndustry sends the industry confirmation literal and mask", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ id: "m2", status: "succeeded", idempotent: false }))
    vi.stubGlobal("fetch", fetchMock)
    await publishIndustry("loc-1", { operation: "update_business_calls", updateMask: ["callsState"], payload: { callsState: "DISABLED" } })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.confirmation).toBe("publish_industry_data_to_google")
    expect(body.updateMask).toEqual(["callsState"])
  })
})

describe("runAdministrationOperation", () => {
  it("looks up the exact confirmation literal per operation", async () => {
    expect(ADMINISTRATION_CONFIRMATIONS.delete_location).toBe("delete_google_location_permanently")
    expect(DANGER_ZONE_OPERATIONS.has("transfer_location")).toBe(true)
    expect(DANGER_ZONE_OPERATIONS.has("create_admin")).toBe(false)
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ id: "m3", status: "succeeded", idempotent: false }))
    vi.stubGlobal("fetch", fetchMock)
    await runAdministrationOperation("loc-1", { operation: "delete_admin", payload: { name: "accounts/1/admins/9" } })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({ operation: "delete_admin", confirmation: "remove_google_administrator", payload: { name: "accounts/1/admins/9" } })
  })
})
