import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, test } from "@playwright/test"

import { readJourneyState } from "./helpers/stub-bridge"

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
const STRUCTURE_RULES = ["landmark-no-duplicate-main", "landmark-main-is-top-level", "heading-order", "page-has-heading-one"]

async function applyCookie(page: Page, baseURL: string | undefined, cookie: string) {
  const [name, value] = cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
}

// Every test in this file runs as the journey org's owner (seeded in
// stub-bridge.ts with performance/keyword rows against its linked location),
// not the default no-cookie local-bootstrap session - that org has zero
// locations by design (see 20260729000400_remove_local_demo_data), so the
// "seeded ready" Google-performance and keywords assertions below would be
// unreachable without it, and the clean-load/axe guards would only ever
// exercise the empty-state panels rather than the populated chart/table
// paths they are meant to prove clean.
test.describe("reports", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
  })

  test("exposes three tabs and defaults to reply performance", async ({ page }) => {
    await page.goto("/reports")
    await expect(page).toHaveURL("/reports")
    await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible()
    await expect(page.getByRole("tab", { name: "Reply performance" })).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("tab", { name: "Google performance" })).toBeVisible()
    await expect(page.getByRole("tab", { name: "Keywords" })).toBeVisible()
  })

  test("puts the active tab in the URL and restores it on reload", async ({ page }) => {
    await page.goto("/reports")
    await page.getByRole("tab", { name: "Keywords" }).click()
    await expect(page).toHaveURL(/[?&]tab=keywords/)
    await page.reload()
    await expect(page.getByRole("tab", { name: "Keywords" })).toHaveAttribute("aria-selected", "true")
  })

  test("reply performance shows KPI tiles, a prior-window delta, and the by-location table", async ({ page }) => {
    await page.goto("/reports")
    // "Reviews" labels both the KPI tile and the by-location table's column
    // header; the KPI grid renders first in DOM order, so .first() resolves
    // the strict-mode ambiguity deterministically rather than guessing.
    await expect(page.getByText("Reviews", { exact: true }).first()).toBeVisible()
    await expect(page.getByText("Response rate").first()).toBeVisible()
    // Non-colour delta cue: an arrow glyph (an SVG, aria-hidden) sits beside
    // the signed magnitude, and the direction is spoken through a
    // visually-hidden word so a screen reader hears "Up +2" rather than a
    // bare number. The journey org has 2 reviews in the current 30-day
    // window and 0 in the prior window, so the Reviews KPI renders a real
    // delta; match the spoken form, which includes the hidden word.
    const delta = page.getByText(/(Up|Down|No change)\s*[+±−]/).first()
    await expect(delta).toBeVisible()
    await expect(delta.locator("svg")).toHaveCount(1)
    await expect(page.getByRole("columnheader", { name: "Location" })).toBeVisible()
  })

  test("google performance renders humanised metric tiles (seeded ready)", async ({ page }) => {
    await page.goto("/performance?tab=google")
    await expect(page.getByText("Calls")).toBeVisible()
    await expect(page.getByText("Website clicks")).toBeVisible()
  })

  test("keywords tab shows honest 'N+' for a thresholded term (seeded ready)", async ({ page }) => {
    await page.goto("/performance?tab=keywords")
    await expect(page.getByText("riverside hotel bath")).toBeVisible()
    await expect(page.getByText("1,000+")).toBeVisible()
  })

  test("analytics redirects to performance", async ({ page }) => {
    await page.goto("/analytics")
    await expect(page).toHaveURL("/reports")
  })

  for (const theme of ["light", "dark"] as const) {
    test(`is free of console and page errors (${theme})`, async ({ page }) => {
      const consoleErrors: string[] = []
      const pageErrors: string[] = []
      page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()) })
      page.on("pageerror", (e) => pageErrors.push(e.message))
      await page.emulateMedia({ colorScheme: theme })
      await page.goto("/reports")
      await expect(page.getByRole("tab", { name: "Reply performance" })).toBeVisible()
      await page.getByRole("tab", { name: "Google performance" }).click()
      await page.getByRole("tab", { name: "Keywords" }).click()
      await page.waitForLoadState("networkidle")
      expect(consoleErrors, `${theme} console`).toEqual([])
      expect(pageErrors, `${theme} pageerror`).toEqual([])
    })

    test(`is axe-clean including structure (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      await page.goto("/reports")
      await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible()
      await page.waitForLoadState("networkidle")
      const wcag = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
      expect(wcag.violations, `${theme} wcag`).toEqual([])
      const best = await new AxeBuilder({ page }).withTags(["best-practice"]).analyze()
      expect(best.violations.filter((v) => STRUCTURE_RULES.includes(v.id)), `${theme} structure`).toEqual([])
    })
  }
})
