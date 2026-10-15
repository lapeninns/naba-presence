import { expect, type Page, type Request, test } from "@playwright/test"

import { readJourneyState } from "./helpers/stub-bridge"

// WP-08 / W5-01 (docs/audits/2026-10-14-full-stack-audit): the inbox keeps
// its selection, queue and filters in the address, but rewrites it through
// the history API (lib/navigation/shallow-url.ts). A row click used to be a
// `router.replace`, which re-ran the dynamic inbox page on the server (one
// RSC request, five transactions) and hydrated a fresher first page over
// every page the list had loaded (X1-01).

/** An RSC flight for the inbox page itself (not a link prefetch elsewhere). */
function isInboxFlight(request: Request): boolean {
  const url = new URL(request.url())
  if (url.pathname !== "/inbox") return false
  return url.searchParams.has("_rsc") || request.headers()["rsc"] === "1"
}

async function openInbox(page: Page, baseURL: string | undefined) {
  const state = await readJourneyState()
  const [name, value] = state.cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/inbox?queue=all")
  const rows = page.locator('[data-slot="review-row"]')
  await expect(rows.first()).toBeVisible()
  // The desktop auto-selects the first row on load.
  await expect(page).toHaveURL(/selected=/)
  await page.waitForLoadState("networkidle")
  return rows
}

test.describe("inbox URL state", () => {
  test("a row click asks the server for no page render", async ({
    baseURL,
    page,
  }) => {
    const rows = await openInbox(page, baseURL)
    const flights: string[] = []
    page.on("request", (request) => {
      if (isInboxFlight(request)) flights.push(request.url())
    })

    const count = Math.min(await rows.count(), 5)
    expect(count).toBeGreaterThan(1)
    for (let index = count - 1; index >= 0; index -= 1) {
      const row = rows.nth(index)
      await row.click()
      await expect(row).toHaveAttribute("aria-current", "true")
    }
    await page.waitForLoadState("networkidle")

    expect(flights).toEqual([])
  })

  test("selecting reviews on the desk adds no history entries", async ({
    baseURL,
    page,
  }) => {
    const rows = await openInbox(page, baseURL)
    const before = await page.evaluate(() => window.history.length)
    const count = Math.min(await rows.count(), 5)
    for (let index = count - 1; index >= 0; index -= 1) {
      const row = rows.nth(index)
      await row.click()
      await expect(row).toHaveAttribute("aria-current", "true")
    }
    expect(await page.evaluate(() => window.history.length)).toBe(before)
  })

  test("the loaded rows survive a selection", async ({ baseURL, page }) => {
    const rows = await openInbox(page, baseURL)
    // Past the first page where the tenant has one (50 rows a page): that
    // is the case a re-hydrated first page used to cut back to 50.
    const more = page.getByRole("button", { name: "Load more" })
    if (await more.isVisible()) {
      const first = await rows.count()
      await more.click()
      await expect.poll(() => rows.count()).toBeGreaterThan(first)
    }
    const loaded = await rows.count()
    await rows.nth(loaded - 1).click()
    await expect(rows.nth(loaded - 1)).toHaveAttribute("aria-current", "true")
    await page.waitForLoadState("networkidle")
    expect(await rows.count()).toBe(loaded)
  })

  // INB-07 / R05: the client scope belongs to the app bar, so it is neither a
  // filter chip nor something "Clear all filters" takes away.
  test("Clear all filters keeps the client scope", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    const [name, value] = state.cookie.split("=", 2)
    await page.context().addCookies([{ name, value, url: baseURL! }])
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`/inbox?queue=all&clientId=${state.clientId}&rating=5`)

    // The rating is a filter chip; the scope is not.
    const chips = page.locator('[data-slot="active-filter-chips"]')
    await expect(chips.getByText("Rating: 5 stars")).toBeVisible()
    await expect(chips.getByText(/^Client:/)).toHaveCount(0)

    await chips.getByRole("button", { name: "Clear all filters" }).click()

    await expect(page).not.toHaveURL(/rating=/)
    await expect(page).toHaveURL(new RegExp(`clientId=${state.clientId}(&|$)`))
    // Nothing narrows the list any more, so the chip row is gone.
    await expect(chips).toHaveCount(0)
  })
})
