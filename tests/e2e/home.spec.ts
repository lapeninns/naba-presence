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
    // Health labels only render once analytics resolves — proving the
    // populated (non-loading, non-error) state was reached.
    await expect(page.getByText("Reviews received")).toBeVisible()
    await expect(page.getByText("Average rating")).toBeVisible()
    await expect(page.getByText("Response rate")).toBeVisible()
    await expect(
      page.getByRole("heading", { name: "Your work" })
    ).toBeVisible()
  })

  test("overview redirects to home", async ({ page }) => {
    await page.goto("/overview")
    await expect(page).toHaveURL("/home")
  })

  test("renders the pulse chart that cross-links to performance", async ({
    page,
  }) => {
    await page.goto("/home")
    await expect(page.getByRole("heading", { name: "Pulse" })).toBeVisible()
    const link = page.getByRole("link", { name: /See Performance/i }).first()
    await expect(link).toHaveAttribute("href", "/performance")
  })

  test("attention rows link to the location's low-rated reviews", async ({
    page,
  }) => {
    await page.goto("/home")
    // The default no-cookie session (local-bootstrap org) may have no rows;
    // when a row exists, its href must carry the low-rated filter.
    const rows = page.getByRole("link", { name: /unresolved/ })
    if (await rows.count()) {
      await expect(rows.first()).toHaveAttribute(
        "href",
        /\/inbox\?locationId=[^&]+&rating=1,2/
      )
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
      await expect(page.getByText("Average rating")).toBeVisible()
      await page.waitForLoadState("networkidle")
      expect(consoleErrors, `${theme} console`).toEqual([])
      expect(pageErrors, `${theme} pageerror`).toEqual([])
    })

    test(`is axe-clean including structure (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      await page.goto("/home")
      await expect(page.getByText("Average rating")).toBeVisible()
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
