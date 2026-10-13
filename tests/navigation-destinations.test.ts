import { describe, expect, it } from "vitest"

import {
  DESTINATIONS,
  destinationForPath,
  destinationHref,
  isActivePath,
  isTopLevelPath,
  moreDestinations,
  sidebarDestinations,
  tabDestinations,
  TAB_COUNT,
  visibleDestinations,
  type Destination,
  type NavigationContext,
} from "@/lib/navigation/destinations"
import type { WorkspaceMode } from "@/lib/workspace/terms"

// The one registry every navigation surface reads (tab bar, More sheet,
// rail, sidebar, palette, 404). These pin its gating so a surface can
// never show a destination the session may not reach.

const ids = (destinations: Destination[]) => destinations.map((d) => d.id)

const ROLES = ["owner", "admin", "member", "viewer", null] as const
const MODES: WorkspaceMode[] = ["agency", "business"]
const managers = new Set<string | null>(["owner", "admin"])

function expectedVisible({
  role,
  mode,
  hideCalendar = false,
}: NavigationContext): string[] {
  return [
    "inbox",
    "listings",
    ...(mode === "agency" ? ["clients"] : []),
    ...(hideCalendar ? [] : ["calendar"]),
    "reports",
    "notifications",
    ...(managers.has(role) ? ["team"] : []),
    "settings",
  ]
}

describe("visibleDestinations", () => {
  for (const mode of MODES) {
    for (const role of ROLES) {
      for (const hideCalendar of [false, true]) {
        const context = { role, mode, hideCalendar }
        it(`gates ${mode} / ${role ?? "unknown role"}${hideCalendar ? " / scheduling off" : ""}`, () => {
          expect(ids(visibleDestinations(context))).toEqual(
            expectedVisible(context)
          )
        })
      }
    }
  }

  it("hides Team while the role is unknown, so it never appears then vanishes", () => {
    expect(
      ids(visibleDestinations({ role: null, mode: "agency" }))
    ).not.toContain("team")
  })

  it("never offers Clients to a business", () => {
    for (const role of ROLES) {
      expect(
        ids(visibleDestinations({ role, mode: "business" }))
      ).not.toContain("clients")
    }
  })
})

describe("tabDestinations and moreDestinations", () => {
  it("gives an agency Inbox, Listings, Clients, Reports and the rest in More", () => {
    const context = { role: "owner", mode: "agency" } as const
    expect(ids(tabDestinations(context))).toEqual([
      "inbox",
      "listings",
      "clients",
      "reports",
    ])
    expect(ids(moreDestinations(context))).toEqual([
      "calendar",
      "notifications",
      "team",
      "settings",
    ])
  })

  it("gives a business Inbox, Listings, Calendar, Reports", () => {
    const context = { role: "owner", mode: "business" } as const
    expect(ids(tabDestinations(context))).toEqual([
      "inbox",
      "listings",
      "calendar",
      "reports",
    ])
    expect(ids(moreDestinations(context))).toEqual([
      "notifications",
      "team",
      "settings",
    ])
  })

  it("fills a business's fourth tab with Notifications when scheduling is off", () => {
    const context = {
      role: "owner",
      mode: "business",
      hideCalendar: true,
    } as const
    expect(ids(tabDestinations(context))).toEqual([
      "inbox",
      "listings",
      "reports",
      "notifications",
    ])
    expect(ids(moreDestinations(context))).toEqual(["team", "settings"])
  })

  it("moves Calendar out of an agency's More when scheduling is off", () => {
    const context = {
      role: "member",
      mode: "agency",
      hideCalendar: true,
    } as const
    expect(ids(tabDestinations(context))).toEqual([
      "inbox",
      "listings",
      "clients",
      "reports",
    ])
    expect(ids(moreDestinations(context))).toEqual([
      "notifications",
      "settings",
    ])
  })

  it("leaves Team out of More for members and viewers, and keeps Settings", () => {
    for (const role of ["member", "viewer", null]) {
      for (const mode of MODES) {
        const more = ids(moreDestinations({ role, mode }))
        expect(more).not.toContain("team")
        expect(more).toContain("settings")
      }
    }
  })

  it("always has four tabs, and tabs plus More cover every visible destination once", () => {
    for (const mode of MODES) {
      for (const role of ROLES) {
        for (const hideCalendar of [false, true]) {
          const context = { role, mode, hideCalendar }
          const tabs = ids(tabDestinations(context))
          const more = ids(moreDestinations(context))
          expect(tabs).toHaveLength(TAB_COUNT)
          expect([...tabs, ...more].sort()).toEqual(
            ids(visibleDestinations(context)).sort()
          )
        }
      }
    }
  })
})

describe("sidebarDestinations", () => {
  it("splits daily work from organisation admin and leaves Notifications to the bell", () => {
    expect(
      sidebarDestinations({ role: "admin", mode: "agency" })
    ).toMatchObject({
      primary: [
        { id: "inbox" },
        { id: "listings" },
        { id: "clients" },
        { id: "calendar" },
        { id: "reports" },
      ],
      more: [{ id: "team" }, { id: "settings" }],
    })
    const groups = sidebarDestinations({
      role: "viewer",
      mode: "business",
      hideCalendar: true,
    })
    expect(ids(groups.primary)).toEqual(["inbox", "listings", "reports"])
    expect(ids(groups.more)).toEqual(["settings"])
    for (const mode of MODES) {
      const all = sidebarDestinations({ role: "owner", mode })
      expect(ids([...all.primary, ...all.more])).not.toContain("notifications")
    }
  })
})

describe("destinationHref", () => {
  const byId = (id: string) => DESTINATIONS.find((d) => d.id === id)!

  it("carries the agency's client on Inbox, Listings and Reports only", () => {
    expect(destinationHref(byId("inbox"), "agency", "c2")).toBe(
      "/inbox?clientId=c2"
    )
    expect(destinationHref(byId("listings"), "agency", "c2")).toBe(
      "/listings?clientId=c2"
    )
    expect(destinationHref(byId("reports"), "agency", "c2")).toBe(
      "/reports?clientId=c2"
    )
    for (const id of [
      "clients",
      "calendar",
      "notifications",
      "team",
      "settings",
    ]) {
      expect(destinationHref(byId(id), "agency", "c2")).toBe(byId(id).href)
    }
  })

  it("links every client when none is in scope", () => {
    expect(destinationHref(byId("inbox"), "agency", null)).toBe("/inbox")
  })

  it("never writes a client into a business address", () => {
    for (const destination of DESTINATIONS) {
      expect(destinationHref(destination, "business", "c2")).toBe(
        destination.href
      )
    }
  })
})

describe("paths", () => {
  it("matches a destination's page and anything beneath it, not a prefix", () => {
    expect(isActivePath("/listings", "/listings")).toBe(true)
    expect(isActivePath("/listings/l1/hours", "/listings")).toBe(true)
    expect(isActivePath("/listingsx", "/listings")).toBe(false)
    expect(isActivePath(null, "/listings")).toBe(false)
  })

  it("files a path under its destination", () => {
    expect(destinationForPath("/listings/l1")?.id).toBe("listings")
    expect(destinationForPath("/clients/c1/settings")?.id).toBe("clients")
    expect(destinationForPath("/settings/billing")?.id).toBe("settings")
    expect(destinationForPath("/setup")).toBeNull()
  })

  it("knows a top-level page from a deep one", () => {
    for (const destination of DESTINATIONS) {
      expect(isTopLevelPath(destination.href)).toBe(true)
    }
    expect(isTopLevelPath(null)).toBe(true)
    expect(isTopLevelPath("/setup")).toBe(true)
    for (const deep of [
      "/listings/l1",
      "/listings/bulk",
      "/clients/c1",
      "/settings/billing",
      "/setup/connect",
    ]) {
      expect(isTopLevelPath(deep)).toBe(false)
    }
  })

  it("marks only the Inbox as having its own search", () => {
    expect(DESTINATIONS.filter((d) => d.ownSearch).map((d) => d.id)).toEqual([
      "inbox",
    ])
  })
})
