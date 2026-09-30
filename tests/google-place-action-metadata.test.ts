import { beforeEach, describe, expect, it, vi } from "vitest"
import { listGooglePlaceActionMetadata, requireGooglePlaceActionType } from "@/lib/server/google/place-action-metadata"
import { googleRequest } from "@/lib/server/google/transport"

vi.mock("@/lib/server/google/transport", () => ({ googleRequest: vi.fn() }))
const request = vi.mocked(googleRequest)
beforeEach(() => request.mockReset())

describe("exact location place-action metadata", () => {
  it("filters the exact target, consumes every page, deduplicates and preserves unsupported future types", async () => {
    request.mockResolvedValueOnce({ placeActionTypeMetadata: [{ placeActionType: "SHOP_ONLINE" }, { placeActionType: "FUTURE_ACTION" }], nextPageToken: "next" })
      .mockResolvedValueOnce({ placeActionTypeMetadata: [{ placeActionType: "SHOP_ONLINE" }, { placeActionType: "APPOINTMENT" }] })
    const result = await listGooglePlaceActionMetadata("token", "locations/fixture", { connectionKey: "connection" })
    expect(result.supportedTypes).toEqual(["SHOP_ONLINE", "APPOINTMENT"])
    expect(result.unsupportedTypes).toEqual(["FUTURE_ACTION"])
    expect(Number.isNaN(Date.parse(result.observedAt))).toBe(false)
    const first = new URL(String(request.mock.calls[0][0])), second = new URL(String(request.mock.calls[1][0]))
    expect(first.hostname).toBe("mybusinessplaceactions.googleapis.com")
    expect(first.searchParams.get("filter")).toBe("location=locations/fixture")
    expect(first.searchParams.has("pageToken")).toBe(false)
    expect(second.searchParams.get("pageToken")).toBe("next")
    expect(request.mock.calls.every((call) => call[2]?.method === "GET" && call[3]?.connectionKey === "connection")).toBe(true)
  })
  it("rejects incomplete looping pagination rather than treating its first page as support", async () => {
    request.mockResolvedValue({ placeActionTypeMetadata: [{ placeActionType: "SHOP_ONLINE" }], nextPageToken: "same" })
    await expect(listGooglePlaceActionMetadata("token", "locations/fixture")).rejects.toMatchObject({ code: "place_action_metadata_page_loop" })
    expect(request).toHaveBeenCalledTimes(2)
  })
  it("does not invent enum-wide support from an empty provider response", async () => {
    request.mockResolvedValue({})
    expect(await listGooglePlaceActionMetadata("token", "locations/fixture")).toMatchObject({ supportedTypes: [], unsupportedTypes: [] })
    await expect(requireGooglePlaceActionType("token", "locations/fixture", "SHOP_ONLINE")).rejects.toMatchObject({ code: "place_action_not_supported" })
  })
  it("rejects malformed provider data without exposing a supported type", async () => {
    request.mockResolvedValue({ placeActionTypeMetadata: [{ placeActionType: 3 }] })
    await expect(listGooglePlaceActionMetadata("token", "locations/fixture")).rejects.toMatchObject({ code: "place_action_metadata_invalid" })
  })
  it("rejects an invalid target before provider access", async () => {
    await expect(listGooglePlaceActionMetadata("token", "locations/fixture OR region_code=GB")).rejects.toMatchObject({ code: "google_target_invalid" })
    expect(request).not.toHaveBeenCalled()
  })
})
