import { describe, expect, it } from "vitest"

import {
  clientFromPath,
  clientPageKind,
  clientScopeCookie,
  clientSwitchTarget,
  currentClientId,
  isClientIdToken,
  parseClientScopeCookie,
  syncClientScope,
  withClientScope,
} from "@/lib/clients/scope"

const visible = new Set(["c1", "c2", "c3"])

describe("client page kinds", () => {
  it("tells scoped, client, listing and other pages apart", () => {
    expect(clientPageKind("/inbox")).toBe("scoped")
    expect(clientPageKind("/listings")).toBe("scoped")
    expect(clientPageKind("/reports")).toBe("scoped")
    expect(clientPageKind("/clients/c1")).toBe("client")
    expect(clientPageKind("/clients/c1/settings")).toBe("client")
    expect(clientPageKind("/clients/new")).toBe("other")
    expect(clientPageKind("/clients")).toBe("other")
    expect(clientPageKind("/listings/l1")).toBe("listing")
    expect(clientPageKind("/listings/l1/hours")).toBe("listing")
    expect(clientPageKind("/team")).toBe("other")
    expect(clientPageKind("/settings/connections")).toBe("other")
    expect(clientPageKind(null)).toBe("other")
  })

  it("splits a client page into the client and its sub-page", () => {
    expect(clientFromPath("/clients/c1/settings")).toEqual({
      clientId: "c1",
      rest: "/settings",
    })
    expect(clientFromPath("/clients/c1")).toEqual({ clientId: "c1", rest: "" })
    expect(clientFromPath("/inbox")).toBeNull()
  })

  it("accepts ids but not the board's Unfiled pseudo-client or junk", () => {
    expect(isClientIdToken("3f2b1c9e-0000-4000-8000-000000000001")).toBe(true)
    expect(isClientIdToken("c1")).toBe(true)
    expect(isClientIdToken("__unfiled__")).toBe(false)
    expect(isClientIdToken("a;b")).toBe(false)
    expect(isClientIdToken("")).toBe(false)
    expect(isClientIdToken(null)).toBe(false)
  })
})

describe("the current client", () => {
  const base = {
    searchClientId: null,
    pageClientId: null,
    remembered: null,
    visibleIds: visible,
  }

  it("follows the address on Inbox, Listings and Reports, not the preference", () => {
    expect(
      currentClientId({
        ...base,
        pathname: "/inbox",
        searchClientId: "c2",
        remembered: "c1",
      })
    ).toBe("c2")
    // An unscoped address is All clients, whatever is remembered: the page
    // shows every client until the address says otherwise.
    expect(
      currentClientId({ ...base, pathname: "/reports", remembered: "c1" })
    ).toBeNull()
  })

  it("is the path's client on a client's own pages", () => {
    expect(
      currentClientId({
        ...base,
        pathname: "/clients/c3/settings",
        remembered: "c1",
      })
    ).toBe("c3")
  })

  it("is the listing's client on a listing page, else the preference", () => {
    expect(
      currentClientId({
        ...base,
        pathname: "/listings/l1",
        pageClientId: "c2",
        remembered: "c1",
      })
    ).toBe("c2")
    expect(
      currentClientId({ ...base, pathname: "/listings/l1", remembered: "c1" })
    ).toBe("c1")
  })

  it("is the preference on pages with no client of their own", () => {
    expect(
      currentClientId({ ...base, pathname: "/team", remembered: "c1" })
    ).toBe("c1")
  })

  it("never names a client the session cannot see", () => {
    for (const input of [
      { pathname: "/inbox", searchClientId: "gone" },
      { pathname: "/clients/gone" },
      { pathname: "/team", remembered: "gone" },
      { pathname: "/listings/l1", pageClientId: "gone" },
    ]) {
      expect(currentClientId({ ...base, ...input })).toBeNull()
    }
  })
})

describe("keeping the preference and the address in step", () => {
  const base = {
    pageClientId: null,
    visibleIds: visible,
  }

  it("fills the remembered client into a scoped page arrived at unscoped", () => {
    expect(
      syncClientScope({
        ...base,
        pathname: "/inbox",
        searchClientId: null,
        remembered: "c1",
        previous: { pathname: "/team", searchClientId: null },
      })
    ).toEqual({ searchClientId: "c1" })
    // First load counts as arriving.
    expect(
      syncClientScope({
        ...base,
        pathname: "/reports",
        searchClientId: null,
        remembered: "c1",
        previous: null,
      })
    ).toEqual({ searchClientId: "c1" })
  })

  it("does not fill a client in over a narrower location or review", () => {
    expect(
      syncClientScope({
        ...base,
        pathname: "/reports",
        searchClientId: null,
        remembered: "c1",
        previous: null,
        narrowed: true,
      })
    ).toEqual({})
  })

  it("forgets the client when the scope is removed on the same page", () => {
    expect(
      syncClientScope({
        ...base,
        pathname: "/inbox",
        searchClientId: null,
        remembered: "c1",
        previous: { pathname: "/inbox", searchClientId: "c1" },
      })
    ).toEqual({ remember: null })
  })

  it("remembers whatever client the address changes to, from any control", () => {
    expect(
      syncClientScope({
        ...base,
        pathname: "/listings",
        searchClientId: "c2",
        remembered: "c1",
        previous: { pathname: "/listings", searchClientId: "c1" },
      })
    ).toEqual({ remember: "c2" })
    expect(
      syncClientScope({
        ...base,
        pathname: "/inbox",
        searchClientId: "c2",
        remembered: null,
        previous: { pathname: "/clients", searchClientId: null },
      })
    ).toEqual({ remember: "c2" })
  })

  it("leaves a just-changed preference alone until the address catches up", () => {
    // The switcher set the preference to All clients; the address still
    // says c1 because the navigation has not landed. Nothing moved, so
    // nothing is re-remembered.
    expect(
      syncClientScope({
        ...base,
        pathname: "/inbox",
        searchClientId: "c1",
        remembered: null,
        previous: { pathname: "/inbox", searchClientId: "c1" },
      })
    ).toEqual({})
  })

  it("drops a client the session can no longer see, silently", () => {
    expect(
      syncClientScope({
        ...base,
        pathname: "/inbox",
        searchClientId: "gone",
        remembered: "gone",
        previous: null,
      })
    ).toEqual({ remember: null, searchClientId: null })
    expect(
      syncClientScope({
        ...base,
        pathname: "/team",
        searchClientId: null,
        remembered: "gone",
        previous: null,
      })
    ).toEqual({ remember: null })
    // Arriving on a scoped page with a stale preference fills nothing in.
    expect(
      syncClientScope({
        ...base,
        pathname: "/inbox",
        searchClientId: null,
        remembered: "gone",
        previous: null,
      })
    ).toEqual({ remember: null })
  })

  it("leaves the board's Unfiled filter alone", () => {
    expect(
      syncClientScope({
        ...base,
        pathname: "/listings",
        searchClientId: "__unfiled__",
        remembered: "c1",
        previous: null,
      })
    ).toEqual({})
  })

  it("remembers the client of a client page or a listing page", () => {
    expect(
      syncClientScope({
        ...base,
        pathname: "/clients/c3/settings",
        searchClientId: null,
        remembered: "c1",
        previous: null,
      })
    ).toEqual({ remember: "c3" })
    expect(
      syncClientScope({
        ...base,
        pathname: "/listings/l1",
        pageClientId: "c2",
        searchClientId: null,
        remembered: null,
        previous: null,
      })
    ).toEqual({ remember: "c2" })
  })

  it("remembers nothing when there is only one client", () => {
    const one = new Set(["c1"])
    expect(
      syncClientScope({
        ...base,
        visibleIds: one,
        pathname: "/clients/c1",
        searchClientId: null,
        remembered: null,
        previous: null,
      })
    ).toEqual({})
    expect(
      syncClientScope({
        ...base,
        visibleIds: one,
        pathname: "/inbox",
        searchClientId: null,
        remembered: "c1",
        previous: null,
      })
    ).toEqual({ remember: null })
  })
})

describe("where a switch goes", () => {
  const search = (value: string) => new URLSearchParams(value)

  it("swaps the scoped page's client and keeps its other parameters", () => {
    expect(
      clientSwitchTarget({
        pathname: "/reports",
        search: search("tab=google&clientId=c1&range=90d"),
        current: "c1",
        next: "c2",
      })
    ).toEqual({
      href: "/reports?tab=google&clientId=c2&range=90d",
      mode: "replace",
    })
  })

  it("drops a location or a selected review that belongs to the old client", () => {
    expect(
      clientSwitchTarget({
        pathname: "/reports",
        search: search("clientId=c1&locationId=l1"),
        current: "c1",
        next: "c2",
      })?.href
    ).toBe("/reports?clientId=c2")
  })

  it("removes the client for All clients", () => {
    expect(
      clientSwitchTarget({
        pathname: "/listings",
        search: search("clientId=c1&order=client"),
        current: "c1",
        next: null,
      })
    ).toEqual({ href: "/listings?order=client", mode: "replace" })
  })

  it("goes to the same sub-page of the other client", () => {
    expect(
      clientSwitchTarget({
        pathname: "/clients/c1/settings",
        search: search(""),
        current: "c1",
        next: "c2",
      })
    ).toEqual({ href: "/clients/c2/settings", mode: "push" })
    expect(
      clientSwitchTarget({
        pathname: "/clients/c1",
        search: search(""),
        current: "c1",
        next: null,
      })
    ).toEqual({ href: "/clients", mode: "push" })
  })

  it("goes from a listing to the other client's hub, or to the board", () => {
    expect(
      clientSwitchTarget({
        pathname: "/listings/l1/hours",
        search: search(""),
        current: "c1",
        next: "c2",
      })
    ).toEqual({ href: "/clients/c2", mode: "push" })
    expect(
      clientSwitchTarget({
        pathname: "/listings/l1",
        search: search(""),
        current: "c1",
        next: null,
      })
    ).toEqual({ href: "/listings", mode: "push" })
  })

  it("stays put on pages with no client, and when nothing changes", () => {
    expect(
      clientSwitchTarget({
        pathname: "/team",
        search: search(""),
        current: null,
        next: "c1",
      })
    ).toBeNull()
    expect(
      clientSwitchTarget({
        pathname: "/inbox",
        search: search("clientId=c1"),
        current: "c1",
        next: "c1",
      })
    ).toBeNull()
  })
})

describe("links and the cookie", () => {
  it("carries the client on links to Inbox, Listings and Reports only", () => {
    expect(withClientScope("/inbox", "c1")).toBe("/inbox?clientId=c1")
    expect(withClientScope("/reports", "c1")).toBe("/reports?clientId=c1")
    expect(withClientScope("/clients", "c1")).toBe("/clients")
    expect(withClientScope("/inbox", null)).toBe("/inbox")
  })

  it("writes and clears the preference cookie", () => {
    expect(clientScopeCookie("c1")).toMatch(
      /^np_client=c1; Path=\/; Max-Age=\d+; SameSite=Lax$/
    )
    expect(clientScopeCookie(null)).toBe(
      "np_client=; Path=/; Max-Age=0; SameSite=Lax"
    )
  })

  it("reads back only a usable id", () => {
    expect(parseClientScopeCookie("c1")).toBe("c1")
    expect(parseClientScopeCookie(undefined)).toBeNull()
    expect(parseClientScopeCookie("__unfiled__")).toBeNull()
    expect(parseClientScopeCookie("%E0%A4%A")).toBeNull()
  })
})
