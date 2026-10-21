import { describe, expect, it } from "vitest"

import {
  adoptingDestination,
  currentHref,
  DESTINATIONS,
  destinationForPath,
  destinationHref,
  isActivePath,
  entityBackLabel,
  listingAreaParent,
  isTopLevelPath,
  moreDestinations,
  navigationPath,
  shortBackLabel,
  sidebarDestinations,
  tabDestinations,
  TAB_COUNT,
  visibleDestinations,
  type Destination,
} from "@/lib/navigation/destinations"
import type { WorkspaceMode } from "@/lib/workspace/terms"

// The one registry every navigation surface reads (tab bar, More sheet,
// rail, sidebar, palette, 404). These pin its gating so a surface can
// never show a destination the session may not reach.

const ids = (destinations: Destination[]) => destinations.map((d) => d.id)

const ROLES = ["owner", "admin", "member", "viewer", null] as const
const MODES: WorkspaceMode[] = ["agency", "business"]

type Role = (typeof ROLES)[number]

/** What each session sees, written out rather than re-derived. */
const VISIBLE: [WorkspaceMode, readonly Role[], boolean, string[]][] = [
  [
    "agency",
    ["owner", "admin"],
    false,
    [
      "inbox",
      "listings",
      "clients",
      "calendar",
      "reports",
      "notifications",
      "team",
      "settings",
    ],
  ],
  [
    "agency",
    ["owner", "admin"],
    true,
    [
      "inbox",
      "listings",
      "clients",
      "reports",
      "notifications",
      "team",
      "settings",
    ],
  ],
  [
    "agency",
    ["member", "viewer", null],
    false,
    [
      "inbox",
      "listings",
      "clients",
      "calendar",
      "reports",
      "notifications",
      "settings",
    ],
  ],
  [
    "agency",
    ["member", "viewer", null],
    true,
    ["inbox", "listings", "clients", "reports", "notifications", "settings"],
  ],
  [
    "business",
    ["owner", "admin"],
    false,
    [
      "inbox",
      "listings",
      "calendar",
      "reports",
      "notifications",
      "team",
      "settings",
    ],
  ],
  [
    "business",
    ["owner", "admin"],
    true,
    ["inbox", "listings", "reports", "notifications", "team", "settings"],
  ],
  [
    "business",
    ["member", "viewer", null],
    false,
    ["inbox", "listings", "calendar", "reports", "notifications", "settings"],
  ],
  [
    "business",
    ["member", "viewer", null],
    true,
    ["inbox", "listings", "reports", "notifications", "settings"],
  ],
]

describe("visibleDestinations", () => {
  for (const [mode, roles, hideCalendar, expected] of VISIBLE) {
    for (const role of roles) {
      it(`gates ${mode} / ${role ?? "unknown role"}${hideCalendar ? " / scheduling off" : ""}`, () => {
        expect(ids(visibleDestinations({ role, mode, hideCalendar }))).toEqual(
          expected
        )
      })
    }
  }

  it("lists every mode, role and scheduling setting exactly once", () => {
    const covered = VISIBLE.flatMap(([mode, roles, hideCalendar]) =>
      roles.map((role) => `${mode}/${role}/${hideCalendar}`)
    )
    expect(new Set(covered).size).toBe(covered.length)
    expect(covered).toHaveLength(MODES.length * ROLES.length * 2)
  })

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

  it("picks the longest matching href as the one current row", () => {
    const rows = ["/settings", "/clients", "/clients/c1", "/listings"]
    expect(currentHref("/settings/notifications", rows)).toBe("/settings")
    expect(currentHref("/listings/l1/hours", rows)).toBe("/listings")
    expect(currentHref("/clients/c1", rows)).toBe("/clients/c1")
    expect(currentHref("/clients/c1/settings", rows)).toBe("/clients/c1")
    expect(currentHref("/clients/c2", rows)).toBe("/clients")
    expect(currentHref("/clientsx", rows)).toBeNull()
    expect(currentHref(null, rows)).toBeNull()
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
    for (const deep of [
      "/listings/l1",
      "/listings/bulk",
      "/clients/c1",
      "/settings/billing",
      // Setup lives under Clients (or Listings), so it has a back control
      // (SET-11), not the workspace name.
      "/setup",
      "/setup/connect",
    ]) {
      expect(isTopLevelPath(deep)).toBe(false)
    }
  })

  it("files Setup under Clients for an agency and Listings for a business", () => {
    expect(adoptingDestination("/setup", "agency")?.id).toBe("clients")
    expect(adoptingDestination("/setup", "business")?.id).toBe("listings")
    expect(adoptingDestination("/setupx", "agency")).toBeNull()
    expect(adoptingDestination("/inbox", "agency")).toBeNull()
    expect(navigationPath("/setup", "agency")).toBe("/clients")
    expect(navigationPath("/setup", "business")).toBe("/listings")
    expect(navigationPath("/listings/l1", "agency")).toBe("/listings/l1")
    expect(navigationPath(null, "agency")).toBeNull()
  })

  it("marks only the Inbox as having its own search", () => {
    expect(DESTINATIONS.filter((d) => d.ownSearch).map((d) => d.id)).toEqual([
      "inbox",
    ])
  })
})

describe("scoped", () => {
  const scopedOf = (id: Destination["id"]) =>
    DESTINATIONS.find((destination) => destination.id === id)?.scoped

  it("marks the organisation-wide pages, which ignore the client scope", () => {
    expect(scopedOf("team")).toBe(false)
    expect(scopedOf("settings")).toBe(false)
    expect(scopedOf("notifications")).toBe(false)
  })

  it("keeps Inbox, Listings and Reports following the scope", () => {
    expect(scopedOf("inbox")).toBe(true)
    expect(scopedOf("listings")).toBe(true)
    expect(scopedOf("reports")).toBe(true)
  })

  it("never carries the client to an organisation-wide page", () => {
    for (const id of ["team", "settings", "notifications"] as const) {
      const destination = DESTINATIONS.find((entry) => entry.id === id)!
      expect(destinationHref(destination, "agency", "c1")).toBe(
        destination.href
      )
    }
  })
})

describe("listingAreaParent", () => {
  it("gives the listing a listing area belongs to", () => {
    for (const path of [
      "/listings/l1/hours",
      "/listings/l1/profile",
      "/listings/l1/photos",
      "/listings/l1/posts",
      "/listings/l1/posts/",
      "/listings/l1/posts/p1",
      "/listings/l1/hours?tab=special#top",
    ]) {
      expect(listingAreaParent(path), path).toBe("/listings/l1")
    }
  })

  it("is null for the board, a listing's own page, bulk and other routes", () => {
    for (const path of [
      "/listings",
      "/listings/",
      "/listings/l1",
      "/listings/l1/",
      "/listings/l1?tab=hours",
      "/listings//hours",
      "/clients/c1/listings",
      "/clients/c1/listings/l1/hours",
      "/listings/bulk/op1",
      "/settings/connections",
      "/inbox",
      "/",
    ]) {
      expect(listingAreaParent(path), path).toBeNull()
    }
    expect(listingAreaParent(null)).toBeNull()
  })
})

describe("entityBackLabel", () => {
  it("names a listing or a client by what it is, whatever its length", () => {
    expect(entityBackLabel({ href: "/listings/l1" })).toBe("Listing")
    expect(entityBackLabel({ href: "/listings/l1?tab=x" })).toBe("Listing")
    expect(entityBackLabel({ href: "/clients/c1" })).toBe("Client")
  })

  it("has nothing to say for any other target", () => {
    expect(entityBackLabel({ href: "/listings" })).toBeNull()
    expect(entityBackLabel({ href: "/listings/l1/hours" })).toBeNull()
    expect(entityBackLabel({ href: "/settings" })).toBeNull()
  })
})

describe("shortBackLabel", () => {
  it("keeps a label that already fits", () => {
    expect(shortBackLabel({ href: "/listings", label: "Listings" })).toBe(
      "Listings"
    )
    expect(shortBackLabel({ href: "/inbox?queue=all", label: "Inbox" })).toBe(
      "Inbox"
    )
  })

  it("says what a named listing or client is", () => {
    expect(
      shortBackLabel({
        href: "/listings/l1",
        label: "Riverside Rooms & Kitchen",
      })
    ).toBe("Listing")
    expect(
      shortBackLabel({ href: "/clients/c1", label: "Journey Hospitality" })
    ).toBe("Client")
  })

  it("uses the destination's own label when it is the shorter one", () => {
    expect(
      shortBackLabel({
        href: "/settings?tab=x",
        label: "Notification settings",
      })
    ).toBe("Settings")
  })

  it("never renames a deeper page after its destination", () => {
    expect(
      shortBackLabel({
        href: "/clients/c1/listings",
        label: "Journey Hospitality listings",
      })
    ).toBe("Journey Hospitality listings")
  })

  it("leaves a long label with nothing shorter to say", () => {
    expect(
      shortBackLabel({ href: "/setup/connect", label: "Connect your account" })
    ).toBe("Connect your account")
  })
})
