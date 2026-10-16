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

type StubHealth =
  | "disconnected"
  | "attention"
  | "healthy"
  | "unchecked"
  | "partially_checked"
  | "unpublished"
  | "not_connected"

function stubClient(
  id: string,
  name: string,
  health: StubHealth,
  overrides: Record<string, unknown> = {}
) {
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
    openWork: { needsReply: 0, awaitingApproval: 0, failed: 0 },
    backfill: { running: 0, failed: 0, succeeded: 2, notStarted: 0 },
    lastSyncAt: "2026-07-31T09:00:00.000Z",
    ...overrides,
  }
}

/**
 * The index reads `/api/clients` in the browser, so the list is stubbed here:
 * the buckets are then exactly the ones the assertions name, whatever the
 * journey org holds. The archived list (`?archived=1`) stays empty.
 */
async function stubClients(page: Page, items: unknown[]) {
  await page.route(/\/api\/clients(?:\?.*)?$/, async (route) => {
    const archived = new URL(route.request().url()).searchParams.has("archived")
    await route.fulfill({
      json: {
        items: archived ? [] : items,
        unassignedLocationCount: 0,
      },
    })
  })
}

/**
 * The shell seeds this list from the server and keeps it fresh for a while, so
 * the stubbed read only lands once the list has gone stale and the tab is shown
 * again.
 */
async function openClients(page: Page, path = "/clients") {
  await page.clock.install()
  await page.goto(path)
  await page.clock.fastForward(10 * 60_000)
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange"))
  )
}

test.describe("clients index", () => {
  test.beforeEach(async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
  })

  test.describe("at a 1280px desk", () => {
    test.use({ viewport: { width: 1280, height: 800 } })

    test("shows only the health buckets that have clients, none clipped, below the search", async ({
      page,
    }) => {
      await stubClients(page, [
        stubClient("c-partial", "Harbour Kitchen", "partially_checked"),
        stubClient("c-healthy", "Old Crown Group", "healthy"),
      ])
      await openClients(page)
      const strip = page.getByRole("group", { name: "Filter by health" })
      await expect(
        strip.getByRole("button", { name: /^Some listings not checked yet/ })
      ).toBeVisible()
      await expect(strip.getByRole("button")).toHaveText([
        "All 2",
        "In sync 1",
        "Some listings not checked yet 1",
      ])
      // The empty near-synonyms are not drawn.
      await expect(
        strip.getByRole("button", { name: /Google login disconnected/ })
      ).toHaveCount(0)
      await expect(
        strip.getByRole("button", { name: /Needs attention/ })
      ).toHaveCount(0)
      // Nothing sits past the edge of the strip: every chip fits.
      const clipped = await strip.evaluate(
        (node) => node.scrollWidth > node.clientWidth + 1
      )
      expect(clipped).toBe(false)
      // Search has a row of its own, above the chips.
      const search = await page
        .getByRole("searchbox", { name: "Filter clients by name" })
        .boundingBox()
      const chips = await strip.boundingBox()
      expect(search).not.toBeNull()
      expect(chips).not.toBeNull()
      expect(chips!.y).toBeGreaterThanOrEqual(search!.y + search!.height)
    })

    test("the open-work count is plain sans text, not a link or code", async ({
      page,
    }) => {
      await stubClients(page, [
        stubClient("c-busy", "Busy Bar", "healthy", {
          openWork: { needsReply: 2, awaitingApproval: 0, failed: 0 },
        }),
      ])
      await openClients(page)
      const row = page.getByRole("row").filter({ hasText: "Busy Bar" })
      const count = row.getByText("2 to reply")
      await expect(count).toBeVisible()
      await expect(row.getByRole("link", { name: /to reply/ })).toHaveCount(0)
      const [countFont, nameFont] = await Promise.all([
        count.evaluate((node) => getComputedStyle(node).fontFamily),
        row
          .getByRole("link", { name: "Busy Bar" })
          .evaluate((node) => getComputedStyle(node).fontFamily),
      ])
      expect(countFont).toBe(nameFont)
    })
  })

  test("a chip filters the list and the address, and pressing it again clears it", async ({
    page,
  }) => {
    await stubClients(page, [
      stubClient("c-broken", "Broken Bistro", "disconnected"),
      stubClient("c-healthy", "Old Crown Group", "healthy"),
    ])
    await openClients(page)
    const strip = page.getByRole("group", { name: "Filter by health" })
    await strip.getByRole("button", { name: /^Google login disconnected/ }).click()
    await expect(page).toHaveURL(/[?&]health=disconnected/)
    await expect(
      page
        .getByRole("main")
        .getByRole("link", { name: "Broken Bistro", exact: true })
    ).toBeVisible()
    await expect(
      page
        .getByRole("main")
        .getByRole("link", { name: "Old Crown Group", exact: true })
    ).toHaveCount(0)
    await strip
      .getByRole("button", { name: /^Google login disconnected/, pressed: true })
      .click()
    await expect(page).not.toHaveURL(/health=/)
    await expect(
      page
        .getByRole("main")
        .getByRole("link", { name: "Old Crown Group", exact: true })
    ).toBeVisible()
  })

  test("a shared link to an empty bucket keeps its chip selected", async ({
    page,
  }) => {
    await stubClients(page, [
      stubClient("c-healthy", "Old Crown Group", "healthy"),
    ])
    await openClients(page, "/clients?health=disconnected")
    const chosen = page
      .getByRole("group", { name: "Filter by health" })
      .getByRole("button", { pressed: true })
    await expect(chosen).toHaveAccessibleName("Google login disconnected, 0")
    await expect(
      page.getByRole("heading", { name: "No clients in “Google login disconnected”" })
    ).toBeVisible()
  })

  test("a client card is one target, with its meta written as sentences", async ({
    page,
  }) => {
    await stubClients(page, [
      stubClient("c-busy", "Busy Bar", "healthy", {
        openWork: { needsReply: 2, awaitingApproval: 0, failed: 0 },
      }),
      stubClient("c-new", "New Cafe", "not_connected", {
        locationCount: 0,
        linkedCount: 0,
        lastSyncAt: null,
      }),
    ])
    await openClients(page)
    const busy = page.getByRole("row").filter({ hasText: "Busy Bar" })
    // The only link in the card is the client's own name.
    await expect(busy.getByRole("link")).toHaveCount(1)
    await expect(busy.getByRole("link")).toHaveAccessibleName("Busy Bar")
    await expect(busy.getByText("2 to reply")).toBeVisible()
    const fresh = page.getByRole("row").filter({ hasText: "New Cafe" })
    await expect(fresh.getByText("Not synced yet")).toBeVisible()
    await expect(page.getByText("Synced Not yet")).toHaveCount(0)
    // Tapping the card opens the client.
    await busy.getByText("2 to reply").click()
    await expect(page).toHaveURL(/\/clients\/c-busy$/)
  })
})
