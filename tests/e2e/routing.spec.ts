import { expect, type Page, test } from "@playwright/test"

import { readJourneyState } from "./helpers/stub-bridge"
import { pageWorkspaceMode } from "./helpers/workspace-mode"

async function applyCookie(
  page: Page,
  baseURL: string | undefined,
  cookie: string
) {
  const [name, value] = cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
}

// The agency destinations: three primary items and the two behind More.
// The flat business routes (/profile, /photos, /posts) are gone: they acted
// on a silently chosen "primary location", which means nothing once an
// organisation looks after several businesses. Home is gone too: the Inbox
// is where the work is, so it is where a session starts.
const dashboardRoutes = [
  { path: "/inbox", label: "Inbox", heading: /^Inbox$/ },
  { path: "/listings", label: "Listings", heading: /^Listings$/ },
  { path: "/clients", label: "Clients", heading: /^Clients$/ },
  { path: "/reports", label: "Reports", heading: /^Reports$/ },
  // More opens itself while Team or Settings is the current page, so the
  // link is in the tree and marked current without a click.
  { path: "/team", label: "Team", heading: /^Team$/ },
  // /settings is Reply policy from md; on a phone it is the grouped
  // settings index, its one h1 "Settings" (the mobile-first spec).
  {
    path: "/settings",
    label: "Settings",
    heading: /^Reply policy$/,
    phoneHeading: /^Settings$/,
  },
]

// The shell draws the Primary nav three ways (components/app-shell): the
// desk sidebar from 1180px (Team and Settings under its "Workspace" label),
// the labelled rail from 768 to 1180 (every destination, no disclosure) and
// the phone tab bar below 768 (four tabs and a More sheet).
const DESK = { width: 1280, height: 800 }
const TABLET = { width: 900, height: 1000 }
const PHONE = { width: 390, height: 844 }

/** The phone tabs; the rest of the destinations live in the More sheet. */
const PHONE_TABS = new Set(["/inbox", "/listings", "/clients", "/reports"])

test("dashboard pages have direct URLs", async ({ page }) => {
  await page.setViewportSize(DESK)
  // A business has no Clients destination (it redirects to Listings).
  const business = (await pageWorkspaceMode(page)) === "business"
  for (const route of dashboardRoutes.filter(
    (entry) => !(business && entry.path === "/clients")
  )) {
    await page.goto(route.path)
    // Pathname only, not a full toHaveURL match: /inbox's desktop
    // auto-selection (see the query-forwarding test below) can append
    // `?selected=<id>` to the URL shortly after landing, and an exact match
    // here would race that client-side rewrite the same way.
    expect(new URL(page.url()).pathname).toBe(route.path)
    await expect(
      page.getByRole("heading", { name: route.heading, level: 1 })
    ).toBeVisible()
    // Scoped to the Primary nav rather than the whole page: labels like
    // "Photos" also exist in the location workspace's own tab nav, and an
    // unscoped lookup would match two links.
    await expect(
      page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: route.label, exact: true })
    ).toHaveAttribute("aria-current", "page")
  }
})

test("dashboard pages mark their tab, or More, as current on a phone", async ({
  page,
}) => {
  await page.setViewportSize(PHONE)
  const business = (await pageWorkspaceMode(page)) === "business"
  for (const route of dashboardRoutes.filter(
    (entry) => !(business && entry.path === "/clients")
  )) {
    await page.goto(route.path)
    expect(new URL(page.url()).pathname).toBe(route.path)
    await expect(
      page.getByRole("heading", {
        name: ("phoneHeading" in route && route.phoneHeading) || route.heading,
        level: 1,
      })
    ).toBeVisible()
    const tabs = page.getByRole("navigation", { name: "Primary" })
    await expect(tabs).toHaveAttribute("data-slot", "tab-bar")
    if (PHONE_TABS.has(route.path)) {
      // The Inbox tab's name may carry its count ("Inbox, 2 need a reply").
      await expect(
        tabs.getByRole("link", {
          name:
            route.label === "Inbox"
              ? /^Inbox(, \d+ needs? a reply)?$/
              : route.label,
          exact: route.label === "Inbox" ? undefined : true,
        })
      ).toHaveAttribute("aria-current", "page")
    } else {
      // Team and Settings live in the More sheet: More reads as current,
      // and the sheet marks the row.
      const more = tabs.getByRole("button", { name: "More", exact: true })
      await expect(more).toHaveAttribute("data-current", "true")
      await more.click()
      await expect(
        page
          .getByRole("dialog", { name: "More" })
          .getByRole("navigation", { name: "More" })
          .getByRole("link", { name: route.label, exact: true })
      ).toHaveAttribute("aria-current", "page")
      await page.keyboard.press("Escape")
      await expect(page.getByRole("dialog", { name: "More" })).toHaveCount(0)
    }
  }
})

test("Setup marks the tab it lives under and goes back to it on a phone", async ({
  page,
}) => {
  // SET-11: /setup belongs to no destination's path, so it had no current
  // tab and the app bar showed the workspace name instead of a way back.
  await page.setViewportSize(PHONE)
  const business = (await pageWorkspaceMode(page)) === "business"
  const owner = business ? "Listings" : "Clients"
  await page.goto("/setup")
  await expect(
    page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: owner, exact: true })
  ).toHaveAttribute("aria-current", "page")
  const barBack = page
    .locator('header[data-slot="app-bar"]')
    .getByRole("link", { name: `Back to ${owner}` })
  await expect(barBack).toBeVisible()
  await barBack.click()
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe(business ? "/listings" : "/clients")
})

test("a settings area has one way back on a phone", async ({ page }) => {
  // SET-04: the app bar's "‹ Settings" is the only back control.
  await page.setViewportSize(PHONE)
  await page.goto("/settings/notifications")
  await expect(
    page.getByRole("heading", { name: "Notifications", level: 1 })
  ).toBeVisible()
  await expect(page.getByRole("link", { name: "All settings" })).toHaveCount(0)
  const barBack = page
    .locator('header[data-slot="app-bar"]')
    .getByRole("link", { name: "Back to Settings" })
  await expect(barBack).toBeVisible()
  await barBack.click()
  await expect.poll(() => new URL(page.url()).pathname).toBe("/settings")
  // The theme is in Settings too (SET-26).
  await expect(
    page.getByRole("button", { name: /^Appearance/ })
  ).toBeVisible()
})

test("the tablet rail lists every destination with a visible label", async ({
  page,
}) => {
  await page.setViewportSize(TABLET)
  const business = (await pageWorkspaceMode(page)) === "business"
  await page.goto("/reports")
  await expect(
    page.getByRole("heading", { name: "Reports", level: 1 })
  ).toBeVisible()
  const sidebar = page.locator('aside[aria-label="Sidebar"]')
  await expect(sidebar).toBeVisible()
  const rail = sidebar.getByRole("navigation", { name: "Primary" })
  // No disclosure in the rail: Team and Settings are tiles like the rest.
  await expect(rail.getByRole("button", { name: "More" })).toBeHidden()
  for (const label of ["Inbox", "Listings", "Reports", "Settings"]) {
    const link = rail.getByRole("link", { name: label, exact: true })
    await expect(link).toBeVisible()
    await expect(link.getByText(label, { exact: true })).toBeVisible()
  }
  await expect(
    rail.getByRole("link", { name: "Clients", exact: true })
  ).toHaveCount(business ? 0 : 1)
  // The phone furniture is gone at this width.
  await expect(page.locator('nav[data-slot="tab-bar"]')).toBeHidden()
  await expect(page.locator('header[data-slot="app-bar"]')).toBeHidden()
  await expect(page.locator('header[data-slot="toolbar"]')).toBeVisible()
})

test("root and the retired home land on the inbox", async ({ page }) => {
  for (const path of ["/", "/home", "/overview"]) {
    await page.goto(path)
    // Pathname only: the inbox's desktop auto-selection appends
    // `?selected=<id>` shortly after landing.
    expect(new URL(page.url()).pathname).toBe("/inbox")
    await expect(
      page.getByRole("heading", { name: "Inbox", level: 1 })
    ).toBeVisible()
  }
})

test("legacy routes redirect to their replacements", async ({ page }) => {
  for (const [from, to] of [
    // Keep the anonymous auth alias first. Visiting any dashboard alias below
    // provisions the local test session, after which /sign-in correctly sends
    // the already-authenticated browser to /inbox.
    ["/login", "/sign-in"],
    ["/locations", "/listings"],
    ["/analytics", "/reports"],
    ["/performance", "/reports"],
    ["/settings/team", "/team"],
    ["/connections", "/settings/connections"],
  ]) {
    await page.goto(from)
    await expect(page).toHaveURL(to)
  }
})

test("login forwards the authentication query string", async ({ page }) => {
  await page.goto(
    "/login?next=%2Finbox&mode=create-account&invite=invite-token&status=invitation_expired"
  )

  const url = new URL(page.url())
  expect(url.pathname).toBe("/sign-in")
  expect(url.searchParams.get("next")).toBe("/inbox")
  expect(url.searchParams.get("mode")).toBe("create-account")
  expect(url.searchParams.get("invite")).toBe("invite-token")
  expect(url.searchParams.get("status")).toBe("invitation_expired")
})

test("reviews redirects to inbox and forwards the query string", async ({
  page,
}) => {
  // /reviews -> /inbox forwards the query string (app/reviews/page.tsx). The
  // shared local LOCAL_BOOTSTRAP org carries ~1065 reviews, so the inbox's
  // desktop auto-selection (components/inbox/inbox-view.tsx) picks the first
  // queued review and client-rewrites the URL to append `selected=<id>`
  // shortly after landing. An exact `toHaveURL("/inbox?queue=…")` assertion
  // races that rewrite (flakes ~1/3 in isolation) — assert the landed
  // pathname and that the forwarded query param survived instead, which
  // holds true whether or not the auto-select rewrite has fired yet.
  await page.goto("/reviews?queue=awaiting_approval")
  const url = new URL(page.url())
  expect(url.pathname).toBe("/inbox")
  expect(url.searchParams.get("queue")).toBe("awaiting_approval")
})

test("sidebar links update browser history", async ({ page }) => {
  // Starts on /reports rather than /inbox: the inbox's desktop auto-selection
  // client-rewrites its own URL to `?selected=<id>` shortly after landing,
  // which races a sidebar click and swallows the navigation. The route this
  // test starts from is incidental to what it asserts.
  const business = (await pageWorkspaceMode(page)) === "business"
  // A business has no Clients item, so Listings stands in for it.
  const first = business
    ? { label: "Listings", path: "/listings" }
    : { label: "Clients", path: "/clients" }
  await page.setViewportSize(DESK)
  await page.goto("/reports")

  const primaryNav = page.getByRole("navigation", { name: "Primary" })

  await primaryNav.getByRole("link", { name: first.label, exact: true }).click()
  await expect(page).toHaveURL(first.path)

  // Settings is always listed, under the sidebar's "Workspace" label: no
  // disclosure to open first.
  await expect(primaryNav.getByRole("button", { name: "More" })).toHaveCount(0)
  await expect(
    primaryNav.getByRole("list", { name: "Workspace" })
  ).toBeVisible()
  await primaryNav.getByRole("link", { name: "Settings", exact: true }).click()
  await expect(page).toHaveURL("/settings")
  // One row is the current page, and the trail names the tab the desk shows.
  await expect(primaryNav.locator('[aria-current="page"]')).toHaveCount(1)
  await expect(
    page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByText("Reply policy")
  ).toHaveAttribute("aria-current", "page")

  await page.goBack()
  await expect(page).toHaveURL(first.path)
})

test("phone tabs and the More sheet update browser history", async ({
  page,
}) => {
  await page.setViewportSize(PHONE)
  const business = (await pageWorkspaceMode(page)) === "business"
  const first = business
    ? { label: "Listings", path: "/listings" }
    : { label: "Clients", path: "/clients" }
  await page.goto("/reports")

  const tabs = page.getByRole("navigation", { name: "Primary" })
  await tabs.getByRole("link", { name: first.label, exact: true }).click()
  await expect(page).toHaveURL(first.path)

  // Settings is two taps away: More opens a sheet, the row is a link.
  await tabs.getByRole("button", { name: "More", exact: true }).click()
  await page
    .getByRole("dialog", { name: "More" })
    .getByRole("navigation", { name: "More" })
    .getByRole("link", { name: "Settings", exact: true })
    .click()
  await expect(page).toHaveURL("/settings")
  await expect(page.getByRole("dialog", { name: "More" })).toHaveCount(0)

  await page.goBack()
  await expect(page).toHaveURL(first.path)
})

test("old location routes land on the listing, owned by Listings in the nav", async ({
  baseURL,
  page,
}) => {
  // A bookmark to the retired workspace keeps its listing and its area: for
  // a tenant with more than one location, sending /locations/<id>/photos to
  // /photos would silently show a DIFFERENT business's photos.
  const state = await readJourneyState()
  await applyCookie(page, baseURL, state.cookie)
  await page.setViewportSize(DESK)
  await page.goto(`/locations/${state.primaryLocationId}/photos`)

  expect(new URL(page.url()).pathname).toBe(
    `/listings/${state.primaryLocationId}/photos`
  )
  await expect(
    page.getByRole("heading", { name: "Photos", level: 1 })
  ).toBeVisible()

  // Listings owns this page: a listing is reached from the board, and the
  // breadcrumb says so.
  const primaryNav = page.getByRole("navigation", { name: "Primary" })
  await expect(
    primaryNav.getByRole("link", { name: "Listings", exact: true })
  ).toHaveAttribute("aria-current", "page")

  // And the trail names the whole path back out (from 1180px).
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible()

  // From 768 to 1180 the trail gives way to one labelled way up, to the
  // listing this area belongs to (lib/navigation/back-target.ts).
  await page.setViewportSize(TABLET)
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeHidden()
  const toolbarBack = page
    .locator('header[data-slot="toolbar"]')
    .getByRole("link", { name: `Back to ${state.directReview.locationName}` })
  await expect(toolbarBack).toBeVisible()
  await expect(
    page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Listings", exact: true })
  ).toHaveAttribute("aria-current", "page")

  // On a phone the app bar carries it, saying what it is ("Listing"): the
  // page's own header row right below names the listing. The full name
  // stays in the link's title.
  await page.setViewportSize(PHONE)
  const barBack = page
    .locator('header[data-slot="app-bar"]')
    .getByRole("link", { name: "Back to Listing", exact: true })
  await expect(barBack).toBeVisible()
  await expect(barBack).toHaveText(/Listing$/)
  await expect(barBack).not.toContainText(state.directReview.locationName)
  await expect(barBack).toHaveAttribute(
    "title",
    state.directReview.locationName
  )
  await expect(
    page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Listings", exact: true })
  ).toHaveAttribute("aria-current", "page")
  await barBack.click()
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe(`/listings/${state.primaryLocationId}`)
})

test("retired flat routes forward to a real location or to Clients", async ({
  baseURL,
  page,
}) => {
  // Bookmarks to the single-business IA still exist. Rather than 404, they
  // resolve: to the one visible location when there is exactly one, and to
  // Clients when the answer is genuinely ambiguous.
  const state = await readJourneyState()
  await applyCookie(page, baseURL, state.cookie)

  for (const path of [
    "/profile",
    "/profile/hours",
    "/profile/menu",
    "/profile/booking",
    "/photos",
    "/posts",
  ]) {
    await page.goto(path)
    const landed = new URL(page.url()).pathname
    expect(landed).not.toBe(path)
    expect(landed === "/clients" || landed.startsWith("/listings/")).toBe(true)
  }
})

test("a client hub names its locations and trails back to Clients", async ({
  baseURL,
  page,
}) => {
  const state = await readJourneyState()
  await applyCookie(page, baseURL, state.cookie)

  await page.goto("/clients")
  await expect(page.getByRole("heading", { name: "Clients", level: 1 })).toBeVisible()
  await page
    .getByRole("table", { name: /Clients, with their Google health/ })
    .getByRole("link", { name: state.clientName })
    .click()

  await expect(page).toHaveURL(`/clients/${state.clientId}`)
  await expect(
    page.getByRole("heading", { name: state.clientName, level: 1 })
  ).toBeVisible()
  // The hub's section is "Listings" (the reference's word for a Google
  // Business Profile), not "Locations".
  await expect(
    page.getByRole("heading", { name: "Listings", level: 2 })
  ).toBeVisible()

  // The trail is what makes the depth navigable: from an area three levels
  // in, the board, the client and the listing are each one click away. It
  // is drawn from 1180px; narrower widths show the back link instead.
  await page.setViewportSize(DESK)
  await page.goto(`/listings/${state.primaryLocationId}/hours`)
  const trail = page.getByRole("navigation", { name: "Breadcrumb" })
  await expect(trail.getByRole("link", { name: "Listings" })).toBeVisible()
  await expect(trail.getByRole("link", { name: state.clientName })).toBeVisible()
  await expect(
    trail.getByRole("link", { name: state.directReview.locationName })
  ).toBeVisible()
})
