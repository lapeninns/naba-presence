import { describe, expect, it } from "vitest"

import { backTarget } from "@/lib/navigation/back-target"
import { breadcrumbTrail } from "@/lib/ui/breadcrumb-trail"

// The phone app bar's and the tablet toolbar's "up": derived from the route
// hierarchy (the breadcrumb trail), never from browser history.

const clients = [{ id: "c1", name: "Old Crown Group" }]
const locations = [
  {
    id: "l1",
    name: "Old Crown Girton",
    clientId: "c1",
    clientName: "Old Crown Group",
  },
]

function back(
  pathname: string,
  { loaded = true, mode = "agency" as "agency" | "business" } = {}
) {
  const trail = breadcrumbTrail({
    pathname,
    clients: loaded ? clients : [],
    locations: loaded ? locations : [],
    mode,
  })
  return backTarget(pathname, trail, mode)
}

describe("backTarget", () => {
  it.each([
    "/inbox",
    "/listings",
    "/clients",
    "/settings",
    "/team",
    "/reports",
  ])("has no back control on the top-level %s", (pathname) => {
    expect(back(pathname)).toBeNull()
  })

  it("has none without a path", () => {
    expect(backTarget(null, [])).toBeNull()
  })

  it("takes a listing's overview up to Listings, not to its client", () => {
    expect(back("/listings/l1")).toEqual({
      href: "/listings",
      label: "Listings",
    })
  })

  it("takes a listing area up to the listing", () => {
    expect(back("/listings/l1/hours")).toEqual({
      href: "/listings/l1",
      label: "Old Crown Girton",
    })
  })

  it("takes a client up to Clients and its settings up to the client", () => {
    expect(back("/clients/c1")).toEqual({ href: "/clients", label: "Clients" })
    expect(back("/clients/c1/settings")).toEqual({
      href: "/clients/c1",
      label: "Old Crown Group",
    })
  })

  it("takes a settings section up to Settings", () => {
    expect(back("/settings/billing")).toEqual({
      href: "/settings",
      label: "Settings",
    })
  })

  it("takes a bulk change up to Listings", () => {
    expect(back("/listings/bulk")).toEqual({
      href: "/listings",
      label: "Listings",
    })
    expect(back("/listings/bulk/op-1")).toEqual({
      href: "/listings",
      label: "Listings",
    })
  })

  it("falls back to the destination while the lists are still loading", () => {
    expect(back("/listings/l1/hours", { loaded: false })).toEqual({
      href: "/listings",
      label: "Listings",
    })
  })

  it("takes Setup up to Clients, or to Listings in a business", () => {
    // SET-11: Setup belongs to no destination's path, so it had no back.
    expect(back("/setup")).toEqual({ href: "/clients", label: "Clients" })
    expect(back("/setup", { mode: "business" })).toEqual({
      href: "/listings",
      label: "Listings",
    })
  })

  it("goes up the same way in business mode, with no client in between", () => {
    expect(back("/listings/l1/hours", { mode: "business" })).toEqual({
      href: "/listings/l1",
      label: "Old Crown Girton",
    })
  })
})
