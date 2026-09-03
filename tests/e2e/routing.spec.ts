import { expect, type Page, test } from "@playwright/test"

import { readJourneyState } from "./helpers/stub-bridge"

async function applyCookie(page: Page, baseURL: string | undefined, cookie: string) {
  const [name, value] = cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
}

// Labels are the single-business names; paths are unchanged for /home and
// /inbox on purpose (see components/app-shell/nav.tsx).
const dashboardRoutes = [
  { path: "/home", label: "Overview", heading: /^Overview$/ },
  { path: "/inbox", label: "Reviews", heading: /^Reviews$/ },
  { path: "/profile", label: "Business profile", heading: /^Business profile$/ },
  { path: "/photos", label: "Photos", heading: /^Photos$/ },
  { path: "/posts", label: "Posts", heading: /^Posts$/ },
  { path: "/performance", label: "Performance", heading: /^Performance$/ },
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
    // Scoped to the Primary nav rather than searching the whole page: as flat
    // business routes land, labels like "Photos" and "Posts" will also exist
    // in the location workspace's own tab nav, and an unscoped lookup would
    // start matching two links.
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
    ["/overview", "/home"],
    ["/analytics", "/performance"],
    ["/connections", "/settings/connections"],
  ]) {
    await page.goto(from)
    await expect(page).toHaveURL(to)
  }
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
  // Starts on /performance rather than /inbox: the inbox's desktop
  // auto-selection client-rewrites its own URL to `?selected=<id>` shortly
  // after landing, which races a sidebar click and swallows the navigation.
  // The route this test starts from is incidental to what it asserts.
  await page.goto("/performance")

  const primaryNav = page.getByRole("navigation", { name: "Primary" })

  await primaryNav.getByRole("link", { name: "Overview", exact: true }).click()
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

  // No FLAT business item claims this page. "Locations" may legitimately be
  // active here (this tenant has several, so the item is shown), but lighting
  // up "Photos" would assert the primary business's photos are on screen when
  // the URL names a different location.
  const primaryNav = page.getByRole("navigation", { name: "Primary" })
  for (const flat of ["Photos", "Posts", "Business profile"]) {
    await expect(
      primaryNav.getByRole("link", { name: flat, exact: true })
    ).not.toHaveAttribute("aria-current", "page")
  }
})

test("business profile sub-sections are reachable and deep-linkable", async ({
  baseURL,
  page,
}) => {
  const state = await readJourneyState()
  await applyCookie(page, baseURL, state.cookie)

  for (const [path, heading] of [
    ["/profile", "Business profile"],
    ["/profile/hours", "Opening hours"],
    ["/profile/menu", "Menu"],
    ["/profile/booking", "Booking links"],
    ["/profile/details", "Business details"],
  ] as const) {
    await page.goto(path)
    expect(new URL(page.url()).pathname).toBe(path)
    await expect(
      page.getByRole("heading", { name: heading, level: 1 })
    ).toBeVisible()
    await expect(
      page.getByRole("navigation", { name: "Business profile sections" })
    ).toBeVisible()
    // The flat routes never expose a location id.
    expect(page.url()).not.toContain(state.primaryLocationId)
  }
})
