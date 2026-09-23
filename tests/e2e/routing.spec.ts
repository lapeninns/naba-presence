import { expect, type Page, test } from "@playwright/test"

import { readJourneyState } from "./helpers/stub-bridge"

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
  { path: "/settings", label: "Settings", heading: /^Reply policy$/ },
]

test("dashboard pages have direct URLs", async ({ page }) => {
  for (const route of dashboardRoutes) {
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
  await page.goto("/reports")

  const primaryNav = page.getByRole("navigation", { name: "Primary" })

  await primaryNav.getByRole("link", { name: "Clients", exact: true }).click()
  await expect(page).toHaveURL("/clients")

  // Settings sits behind More; the disclosure is a button, the row a link.
  await primaryNav.getByRole("button", { name: "More" }).click()
  await primaryNav.getByRole("link", { name: "Settings", exact: true }).click()
  await expect(page).toHaveURL("/settings")

  await page.goBack()
  await expect(page).toHaveURL("/clients")
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

  // And the trail names the whole path back out.
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible()
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
  // in, the board, the client and the listing are each one click away.
  await page.goto(`/listings/${state.primaryLocationId}/hours`)
  const trail = page.getByRole("navigation", { name: "Breadcrumb" })
  await expect(trail.getByRole("link", { name: "Listings" })).toBeVisible()
  await expect(trail.getByRole("link", { name: state.clientName })).toBeVisible()
  await expect(
    trail.getByRole("link", { name: state.directReview.locationName })
  ).toBeVisible()
})
