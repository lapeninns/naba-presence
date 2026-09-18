import { describe, expect, it } from "vitest"

import { breadcrumbTrail } from "@/lib/ui/breadcrumb-trail"

const clients = [{ id: "c1", name: "Old Crown Group" }]
const locations = [
  { id: "l1", name: "Old Crown Girton", clientId: "c1", clientName: "Old Crown Group" },
  { id: "l2", name: "Riverside Cafe", clientId: null, clientName: null },
]

const trail = (pathname: string) =>
  breadcrumbTrail({ pathname, clients, locations }).map((crumb) => crumb.label)

describe("breadcrumbTrail", () => {
  it("names the client a location belongs to", () => {
    expect(trail("/locations/l1/photos")).toEqual([
      "Clients",
      "Old Crown Group",
      "Old Crown Girton",
      "Photos",
    ])
  })

  it("says when a location is filed under no client", () => {
    // Arriving here from a search, "this listing belongs to nobody yet" is
    // exactly the thing the operator needs to know.
    expect(trail("/locations/l2")).toEqual([
      "Clients",
      "Unassigned",
      "Riverside Cafe",
    ])
  })

  it("links every crumb except the current page", () => {
    const crumbs = breadcrumbTrail({
      pathname: "/locations/l1/photos",
      clients,
      locations,
    })
    expect(crumbs.slice(0, -1).every((crumb) => crumb.href)).toBe(true)
    expect(crumbs.at(-1)?.href).toBeUndefined()
  })

  it("falls back to the location list when the id is unknown", () => {
    // A stale link to a deleted location still gets a way back.
    expect(trail("/locations/gone")).toEqual(["All locations"])
  })

  it("handles the client surfaces", () => {
    expect(trail("/clients")).toEqual(["Clients"])
    expect(trail("/clients/c1")).toEqual(["Clients", "Old Crown Group"])
    expect(trail("/clients/c1/settings")).toEqual([
      "Clients",
      "Old Crown Group",
      "Settings",
    ])
    expect(trail("/clients/new")).toEqual(["Clients", "New client"])
  })

  it("handles settings sections and the flat destinations", () => {
    expect(trail("/settings/connections")).toEqual(["Settings", "Connections"])
    expect(trail("/settings")).toEqual(["Settings"])
    expect(trail("/inbox")).toEqual(["Inbox"])
    expect(trail("/team")).toEqual(["Team"])
  })

  it("renders nothing for a path it does not recognise", () => {
    expect(trail("/")).toEqual([])
    expect(trail("/design-system")).toEqual([])
  })
})
