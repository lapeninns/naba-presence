import { beforeEach, describe, expect, it, vi } from "vitest"

const primary = vi.hoisted(() => ({
  current: { locationCount: 2, locationId: null as string | null },
}))
vi.mock("@/lib/server/primary-location", () => ({
  resolvePrimaryLocation: async () => primary.current,
}))

import {
  flatRouteTarget,
  flatSegmentFor,
  withForwardedQuery,
} from "@/lib/server/flat-route-redirect"

beforeEach(() => {
  primary.current = { locationCount: 2, locationId: null }
})

describe("flatRouteTarget", () => {
  it("lands an ambiguous bookmark on Clients with the query and ?moved=", async () => {
    await expect(
      flatRouteTarget("photos", {
        searchParams: { tab: "cover", tag: ["a", "b"] },
        moved: "photos",
      })
    ).resolves.toBe("/clients?tab=cover&tag=a&tag=b&moved=photos")
  })

  it("goes straight to the one listing, keeping the query", async () => {
    primary.current = { locationCount: 1, locationId: "loc-1" }
    await expect(
      flatRouteTarget("posts", {
        searchParams: { status: "draft" },
        moved: "posts",
      })
    ).resolves.toBe("/listings/loc-1/posts?status=draft")
  })

  it("stays bare without a query", async () => {
    await expect(flatRouteTarget("")).resolves.toBe("/clients")
  })
})

describe("withForwardedQuery", () => {
  it("replaces a moved already in the old query", () => {
    expect(withForwardedQuery("/clients", { moved: "x" }, "profile")).toBe(
      "/clients?moved=profile"
    )
  })
})

describe("flatSegmentFor", () => {
  it("maps every listing area an old /profile/<section> can name", () => {
    for (const area of [
      "profile",
      "hours",
      "menu",
      "booking",
      "photos",
      "posts",
      "people",
      "verification",
      "suggestions",
      "changes",
    ]) {
      expect(flatSegmentFor(area)).toBe(area)
    }
    expect(flatSegmentFor("details")).toBe("profile")
  })

  it("sends an unknown section to the overview", () => {
    expect(flatSegmentFor("nonsense")).toBe("")
    expect(flatSegmentFor(undefined)).toBe("")
  })

  // A plain object answers inherited names too; indexing it turned
  // /profile/constructor into /listings/<id>/function Object()...
  it("never returns an inherited Object property", () => {
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(flatSegmentFor(name)).toBe("")
    }
  })
})
