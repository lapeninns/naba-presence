import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
const STRUCTURE_RULES = [
  "landmark-no-duplicate-main",
  "landmark-main-is-top-level",
  "heading-order",
  "page-has-heading-one",
]

test.describe("home", () => {
  test("renders the organisation roll-up", async ({ page }) => {
    await page.goto("/home")
    await expect(page).toHaveURL("/home")
    await expect(
      page.getByRole("heading", { name: "Overview", level: 1 })
    ).toBeVisible()
    // The KPI labels only render once the counts + analytics queries resolve,
    // so asserting them also proves the populated (non-loading, non-error)
    // state was reached.
    // "Average rating" now also labels the Trends "Average rating" chart
    // card (M7); .first() pins the KpiCards StatTile, which is the one that
    // only appears once the counts + analytics queries resolve (the chart
    // card's title renders immediately regardless of query state), so the
    // populated-state assertion the comment above describes still holds.
    await expect(page.getByText("Total reviews")).toBeVisible()
    await expect(page.getByText("Average rating").first()).toBeVisible()
    await expect(page.getByText("Response rate")).toBeVisible()
  })

  test("overview redirects to home", async ({ page }) => {
    await page.goto("/overview")
    await expect(page).toHaveURL("/home")
  })

  test("renders the trends charts that cross-link to performance", async ({ page }) => {
    await page.goto("/home")
    await expect(page.getByRole("heading", { name: "Trends" })).toBeVisible()
    const link = page.getByRole("link", { name: /See Performance/i }).first()
    await expect(link).toHaveAttribute("href", "/performance")
  })

  test("attention rows link to the location's low-rated reviews", async ({ page }) => {
    await page.goto("/home")
    // The default no-cookie session (local-bootstrap org) has zero
    // locations, so this org may have no rows to show; when a row exists,
    // its href must carry the low-rated filter (spec §8).
    const rows = page.getByRole("link", { name: /unresolved/ })
    if (await rows.count()) {
      await expect(rows.first()).toHaveAttribute("href", /\/inbox\?locationId=[^&]+&rating=1,2/)
    }
  })

  for (const theme of ["light", "dark"] as const) {
    test(`is free of console and page errors (${theme})`, async ({ page }) => {
      const consoleErrors: string[] = []
      const pageErrors: string[] = []
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text())
      })
      page.on("pageerror", (error) => {
        pageErrors.push(error.message)
      })
      await page.emulateMedia({ colorScheme: theme })
      await page.goto("/home")
      // .first() - see the strict-mode note on the roll-up test above.
      await expect(page.getByText("Average rating").first()).toBeVisible()
      await page.waitForLoadState("networkidle")
      expect(consoleErrors, `${theme} console`).toEqual([])
      expect(pageErrors, `${theme} pageerror`).toEqual([])
    })

    test(`is axe-clean including structure (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      await page.goto("/home")
      // .first() - see the strict-mode note on the roll-up test above.
      await expect(page.getByText("Average rating").first()).toBeVisible()
      await page.waitForLoadState("networkidle")
      const wcag = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
      expect(wcag.violations, `${theme} wcag`).toEqual([])
      const best = await new AxeBuilder({ page })
        .withTags(["best-practice"])
        .analyze()
      expect(
        best.violations.filter((v) => STRUCTURE_RULES.includes(v.id)),
        `${theme} structure`
      ).toEqual([])
    })
  }
})
