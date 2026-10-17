import AxeBuilder from "@axe-core/playwright"
import { expect, type Locator, type Page, test } from "@playwright/test"

import { readJourneyState } from "./helpers/stub-bridge"

/**
 * The desk quick look (DSK-23, P23): from `lg`, a plain click on a Clients
 * index row or a Listings board row opens the row's work in a right panel
 * with one "Open …" link; the row's name (a click or Enter) and any click
 * below `lg` still open the full page.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]

async function applyCookie(
  page: Page,
  baseURL: string | undefined,
  cookie: string
) {
  const [name, value] = cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
}

/**
 * The panel is axe-clean once it has settled. Its slide-in is waited out
 * through the animations themselves (not a sleep), so no contrast reading is
 * taken from a half-transparent frame.
 */
async function expectPanelAccessible(dialog: Locator, page: Page) {
  await dialog.evaluate((node) =>
    Promise.all(node.getAnimations().map((animation) => animation.finished))
  )
  const wcag = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(WCAG_TAGS)
    .analyze()
  expect(wcag.violations, "quick look wcag").toEqual([])
  // G6 evidence: the settled panel beside its list, kept with the report.
  await test.info().attach(`${test.info().title} (panel)`, {
    body: await page.screenshot(),
    contentType: "image/png",
  })
}

type StubHealth = "healthy" | "attention" | "disconnected"

function stubClient(id: string, name: string, health: StubHealth) {
  return {
    id,
    name,
    slug: id,
    colour: null,
    logoUrl: null,
    notes: null,
    archivedAt: null,
    createdAt: "2026-07-01T09:00:00.000Z",
    locationCount: 2,
    linkedCount: 2,
    verifiedCount: 2,
    health,
    connections: [],
    openWork: { needsReply: 2, awaitingApproval: 1, failed: 1 },
    backfill: { running: 0, failed: 0, succeeded: 2, notStarted: 0 },
    lastSyncAt: "2026-07-31T09:00:00.000Z",
  }
}

/**
 * The index reads `/api/clients` in the browser, so the list is stubbed (as
 * clients.spec.ts does): the row and its work are exactly the ones asserted.
 */
async function stubClients(page: Page, items: unknown[]) {
  await page.route(/\/api\/clients(?:\?.*)?$/, async (route) => {
    const archived = new URL(route.request().url()).searchParams.has("archived")
    await route.fulfill({
      json: { items: archived ? [] : items, unassignedLocationCount: 0 },
    })
  })
}

/**
 * The shell seeds the list from the server and keeps it fresh for a while, so
 * the stubbed read only lands once the list has gone stale and the tab is
 * shown again (the same step as clients.spec.ts).
 */
async function openClients(page: Page) {
  await page.clock.install()
  await page.goto("/clients")
  await page.clock.fastForward(10 * 60_000)
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange"))
  )
}

test.describe("desk quick look", () => {
  test.beforeEach(async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
  })

  test.describe("at a 1280px desk", () => {
    test.use({ viewport: { width: 1280, height: 800 } })

    test("a click on a client row opens its work in a panel, Escape returns to the name link, and Open client opens the page", async ({
      page,
    }) => {
      await stubClients(page, [
        stubClient("c-busy", "Busy Bar", "healthy"),
        stubClient("c-other", "Old Crown Group", "healthy"),
      ])
      await openClients(page)
      const row = page.getByRole("row").filter({ hasText: "Busy Bar" })
      const name = row.getByRole("link", { name: "Busy Bar", exact: true })
      await expect(row.getByText("2 to reply")).toBeVisible()

      // A click on the row, not on the name link.
      await row.getByText("2 to reply").click()
      const panel = page.getByRole("dialog", { name: "Busy Bar" })
      await expect(panel).toBeVisible()
      await expect(page).toHaveURL(/\/clients$/)
      await expect(
        panel.getByRole("heading", { name: "Open review work" })
      ).toBeVisible()
      await expect(
        panel.getByText("Needs reply", { exact: true })
      ).toBeVisible()
      await expect(
        panel.getByText("Awaiting approval", { exact: true })
      ).toBeVisible()
      await expect(
        panel.getByText("Replies that didn’t post", { exact: true })
      ).toBeVisible()
      await expect(panel.getByRole("heading", { name: "Google" })).toBeVisible()
      await expect(
        panel.getByRole("link", { name: "Open client" })
      ).toHaveAttribute("href", "/clients/c-busy")
      await expectPanelAccessible(panel, page)

      // Escape closes it and puts focus back on the row's name link.
      await page.keyboard.press("Escape")
      await expect(panel).toBeHidden()
      await expect(name).toBeFocused()
      await expect(page).toHaveURL(/\/clients$/)

      // The panel's own link opens the client page.
      await row.getByText("2 to reply").click()
      await panel.getByRole("link", { name: "Open client" }).click()
      await expect(page).toHaveURL(/\/clients\/c-busy$/)
    })

    test("a click on a client's name opens the page, not the panel", async ({
      page,
    }) => {
      await stubClients(page, [
        stubClient("c-busy", "Busy Bar", "healthy"),
        stubClient("c-other", "Old Crown Group", "healthy"),
      ])
      await openClients(page)
      const row = page.getByRole("row").filter({ hasText: "Busy Bar" })
      await expect(row.getByText("2 to reply")).toBeVisible()
      await row.getByRole("link", { name: "Busy Bar", exact: true }).click()
      await expect(page).toHaveURL(/\/clients\/c-busy$/)
      await expect(page.getByRole("dialog")).toHaveCount(0)
    })

    test("Enter on a client's name link opens the page, not the panel", async ({
      page,
    }) => {
      await stubClients(page, [
        stubClient("c-busy", "Busy Bar", "healthy"),
        stubClient("c-other", "Old Crown Group", "healthy"),
      ])
      await openClients(page)
      const name = page
        .getByRole("row")
        .filter({ hasText: "Busy Bar" })
        .getByRole("link", { name: "Busy Bar", exact: true })
      await expect(name).toBeVisible()
      await name.focus()
      await page.keyboard.press("Enter")
      await expect(page).toHaveURL(/\/clients\/c-busy$/)
      await expect(page.getByRole("dialog")).toHaveCount(0)
    })

    test("a click on a listing row opens its areas in a panel and Escape closes it", async ({
      page,
    }) => {
      const state = await readJourneyState()
      const listing = state.directReview.locationName
      await page.goto("/listings")
      const row = page.getByRole("row").filter({ hasText: listing })
      await expect(row).toBeVisible()
      // The Waiting column settling means the board has loaded and hydrated,
      // so the click is the desk's and not a plain link navigation.
      await expect(
        row.getByText(/Nothing waiting|to publish|Google change/)
      ).toBeVisible()

      await row.click()
      const panel = page.getByRole("dialog", { name: listing })
      await expect(panel).toBeVisible()
      await expect(page).toHaveURL(/\/listings$/)
      await expect(
        panel.getByRole("heading", { name: "Areas", exact: true })
      ).toBeVisible()
      await expect(
        panel.getByRole("link", { name: "Open listing" })
      ).toHaveAttribute("href", `/listings/${state.primaryLocationId}`)
      await expectPanelAccessible(panel, page)

      await page.keyboard.press("Escape")
      await expect(panel).toBeHidden()
      const name = row.getByRole("link", { name: listing, exact: true })
      await expect(name).toBeFocused()
      await expect(page).toHaveURL(/\/listings$/)

      // The listing's name still opens the listing.
      await name.click()
      await expect(page).toHaveURL(
        new RegExp(`/listings/${state.primaryLocationId}$`)
      )
      await expect(page.getByRole("dialog")).toHaveCount(0)
    })
  })

  test.describe("below lg, at 900px", () => {
    test.use({ viewport: { width: 900, height: 800 } })

    test("a click on a listing row opens the listing, with no panel", async ({
      page,
    }) => {
      const state = await readJourneyState()
      const listing = state.directReview.locationName
      await page.goto("/listings")
      const row = page.getByRole("row").filter({ hasText: listing })
      await expect(row).toBeVisible()
      await expect(
        row.getByText(/Nothing waiting|to publish|Google change/)
      ).toBeVisible()

      await row.click()
      await expect(page).toHaveURL(
        new RegExp(`/listings/${state.primaryLocationId}$`)
      )
      await expect(page.getByRole("dialog")).toHaveCount(0)
    })
  })
})
