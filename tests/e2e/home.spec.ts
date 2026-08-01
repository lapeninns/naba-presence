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
      page.getByRole("heading", { name: "Home", level: 1 })
    ).toBeVisible()
    // The KPI labels only render once the counts + analytics queries resolve,
    // so asserting them also proves the populated (non-loading, non-error)
    // state was reached.
    await expect(page.getByText("Total reviews")).toBeVisible()
    await expect(page.getByText("Average rating")).toBeVisible()
    await expect(page.getByText("Response rate")).toBeVisible()
  })

  test("overview redirects to home", async ({ page }) => {
    await page.goto("/overview")
    await expect(page).toHaveURL("/home")
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
