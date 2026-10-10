import { beforeEach, expect, it, vi } from "vitest"
vi.mock("server-only", () => ({}))
vi.mock("@/lib/server/google/locations", () => ({ listGoogleAttributeMetadata: vi.fn() }))
import { listGoogleAttributeMetadata } from "@/lib/server/google/locations"
import { loadGoogleAttributeMetadata } from "@/lib/server/attribute-metadata"
const list = vi.mocked(listGoogleAttributeMetadata)
beforeEach(() => list.mockReset())
it("loads all location-scoped metadata pages without incompatible language parameters", async () => {
  list.mockResolvedValueOnce({ attributeMetadata: [{ parent: "attributes/a" }], nextPageToken: "next" }).mockResolvedValueOnce({ attributeMetadata: [{ parent: "attributes/b" }] })
  expect(await loadGoogleAttributeMetadata("token", "locations/1", "connection")).toHaveLength(2)
  expect(list).toHaveBeenLastCalledWith("token", { locationName: "locations/1", pageToken: "next" }, { connectionKey: "connection" })
})
it("rejects repeated pagination instead of treating partial metadata as complete", async () => {
  list.mockResolvedValue({ attributeMetadata: [], nextPageToken: "loop" })
  await expect(loadGoogleAttributeMetadata("token", "locations/1", "connection")).rejects.toMatchObject({ code: "attribute_metadata_incomplete" })
  expect(list).toHaveBeenCalledTimes(2)
})
