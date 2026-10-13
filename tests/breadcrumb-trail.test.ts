import fs from "node:fs"
import path from "node:path"

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
  it("names the client a listing belongs to", () => {
    expect(trail("/listings/l1/photos")).toEqual([
      "Listings",
      "Old Crown Group",
      "Old Crown Girton",
      "Photos",
    ])
  })

  it("says when a location is filed under no client", () => {
    // Arriving here from a search, "this listing belongs to nobody yet" is
    // exactly the thing the operator needs to know.
    expect(trail("/listings/l2")).toEqual([
      "Listings",
      "Unfiled",
      "Riverside Cafe",
    ])
  })

  it("links every crumb except the current page", () => {
    const crumbs = breadcrumbTrail({
      pathname: "/listings/l1/photos",
      clients,
      locations,
    })
    expect(crumbs.slice(0, -1).every((crumb) => crumb.href)).toBe(true)
    expect(crumbs.at(-1)?.href).toBeUndefined()
  })

  it("falls back to the location list when the id is unknown", () => {
    // A stale link to a deleted location still gets a way back.
    expect(trail("/listings/gone")).toEqual(["Listings"])
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
    expect(trail("/settings/connections")).toEqual([
      "Settings",
      "Google connections",
    ])
    expect(trail("/settings")).toEqual(["Settings"])
    expect(trail("/inbox")).toEqual(["Inbox"])
    expect(trail("/team")).toEqual(["Team"])
  })

  it("names every real /settings/<section> route the way its tab does", () => {
    // Every page directory under app/(dashboard)/settings, with the label
    // its settings tab (lib/settings/areas.ts) gives it.
    const sections: [string, string][] = [
      ["billing", "Billing"],
      ["connections", "Google connections"],
      ["notifications", "Notifications"],
      ["operations", "Operations"],
      ["policy", "Reply policy"],
      ["privacy", "Data and privacy"],
      ["security", "Sign-in security"],
      ["usage", "Usage"],
    ]
    for (const [segment, label] of sections) {
      const crumbs = breadcrumbTrail({
        pathname: `/settings/${segment}`,
        clients,
        locations,
      })
      expect(crumbs).toEqual([
        { label: "Settings", href: "/settings" },
        { label },
      ])
    }
    // A step inside a section keeps the section's name.
    expect(trail("/settings/billing/confirming")).toEqual([
      "Settings",
      "Billing",
    ])
  })

  it("covers every settings page directory on disk", () => {
    const dir = path.join(process.cwd(), "app/(dashboard)/settings")
    const routes = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          fs.existsSync(path.join(dir, entry.name, "page.tsx"))
      )
      .map((entry) => entry.name)
    expect(routes.length).toBeGreaterThan(0)
    for (const segment of routes) {
      expect(trail(`/settings/${segment}`), segment).toHaveLength(2)
    }
  })

  it("does not name an unknown settings path from the object prototype", () => {
    expect(trail("/settings/constructor")).toEqual(["Settings"])
    expect(trail("/settings/nope")).toEqual(["Settings"])
  })

  it("renders nothing for a path it does not recognise", () => {
    expect(trail("/")).toEqual([])
    expect(trail("/design-system")).toEqual([])
  })
})

describe("breadcrumbTrail in business mode", () => {
  const business = (pathname: string) =>
    breadcrumbTrail({ pathname, clients, locations, mode: "business" }).map((crumb) => crumb.label)

  it("has no client crumb on a listing", () => {
    expect(business("/listings/l1/photos")).toEqual(["Listings", "Old Crown Girton", "Photos"])
    expect(business("/listings/l2")).toEqual(["Listings", "Riverside Cafe"])
  })

  it("has no trail for the client layer", () => {
    expect(business("/clients/c1")).toEqual([])
    expect(business("/clients")).toEqual([])
  })
})
