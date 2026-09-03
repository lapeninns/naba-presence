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

// The six agency destinations. The flat business routes (/profile, /photos,
// /posts) are gone: they acted on a silently chosen "primary location", which
// means nothing once an organisation looks after several businesses.
const dashboardRoutes = [
  { path: "/home", label: "Home", heading: /^Overview$/ },
  { path: "/inbox", label: "Inbox", heading: /^Reviews$/ },
  { path: "/clients", label: "Clients", heading: /^Clients$/ },
  { path: "/reports", label: "Reports", heading: /^Reports$/ },
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

test("root redirects to home", async ({ page }) => {
  await page.goto("/")

  await expect(page).toHaveURL("/home")
  await expect(
    page.getByRole("heading", { name: "Overview", level: 1 })
  ).toBeVisible()
})

test("legacy routes redirect to their replacements", async ({ page }) => {
  for (const [from, to] of [
    // Keep the anonymous auth alias first. Visiting any dashboard alias below
    // provisions the local test session, after which /sign-in correctly sends
    // the already-authenticated browser to /home.
    ["/login", "/sign-in"],
    ["/overview", "/home"],
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

  await primaryNav.getByRole("link", { name: "Home", exact: true }).click()
  await expect(page).toHaveURL("/home")

  await primaryNav.getByRole("link", { name: "Settings", exact: true }).click()
  await expect(page).toHaveURL("/settings")

  await page.goBack()
  await expect(page).toHaveURL("/home")
})

test("nested location routes stay reachable and unclaimed by the primary nav", async ({
  baseURL,
  page,
}) => {
  // The flat IA delists /locations/[id]/* from the sidebar but deliberately
  // does NOT redirect it: for a tenant with more than one location, sending
  // /locations/<id>/photos to /photos would silently show a DIFFERENT
  // business's photos than the bookmark asked for.
  const state = await readJourneyState()
  await applyCookie(page, baseURL, state.cookie)
  await page.goto(`/locations/${state.primaryLocationId}/photos`)

  expect(new URL(page.url()).pathname).toBe(
    `/locations/${state.primaryLocationId}/photos`
  )
  await expect(
    page.getByRole("navigation", { name: "Location sections" })
  ).toBeVisible()

  // Clients owns this page: a location is reached through its client, and the
  // breadcrumb says so, so leaving the sidebar with nothing selected would
  // strand the user.
  const primaryNav = page.getByRole("navigation", { name: "Primary" })
  await expect(
    primaryNav.getByRole("link", { name: "Clients", exact: true })
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
    expect(landed === "/clients" || landed.startsWith("/locations/")).toBe(true)
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
  await expect(
    page.getByRole("heading", { name: "Locations", level: 2 })
  ).toBeVisible()

  // The trail is what makes the depth navigable: from a location three levels
  // in, the client and the client list are both one click away.
  await page.goto(`/locations/${state.primaryLocationId}/hours`)
  const trail = page.getByRole("navigation", { name: "Breadcrumb" })
  await expect(trail.getByRole("link", { name: "Clients" })).toBeVisible()
  await expect(trail.getByRole("link", { name: state.clientName })).toBeVisible()
})
