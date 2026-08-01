import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
const STRUCTURE_RULES = [
  "landmark-no-duplicate-main",
  "landmark-main-is-top-level",
  "heading-order",
  "page-has-heading-one",
]

test.describe("inbox", () => {
  test("renders the cross-location review queue", async ({ page }) => {
    await page.goto("/inbox")
    await expect(page).toHaveURL("/inbox")
    await expect(
      page.getByRole("heading", { name: "Inbox", level: 1 })
    ).toBeVisible()
    await expect(
      page.getByRole("combobox", { name: "Filter by location" })
    ).toBeVisible()
  })

  test("reviews redirects to inbox and forwards the query string", async ({ page }) => {
    await page.goto("/reviews")
    await expect(page).toHaveURL("/inbox")
    await page.goto("/reviews?queue=needs_reply")
    await expect(page).toHaveURL("/inbox?queue=needs_reply")
  })

  for (const theme of ["light", "dark"] as const) {
    test(`is free of console and page errors (${theme})`, async ({ page }) => {
      const consoleErrors: string[] = []
      const pageErrors: string[] = []
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text())
      })
      page.on("pageerror", (error) => pageErrors.push(error.message))
      await page.emulateMedia({ colorScheme: theme })
      await page.goto("/inbox")
      await expect(
        page.getByRole("combobox", { name: "Filter by location" })
      ).toBeVisible()
      await page.waitForLoadState("networkidle")
      expect(consoleErrors, `${theme} console`).toEqual([])
      expect(pageErrors, `${theme} pageerror`).toEqual([])
    })

    test(`is axe-clean including structure (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      await page.goto("/inbox")
      await expect(
        page.getByRole("combobox", { name: "Filter by location" })
      ).toBeVisible()
      await page.waitForLoadState("networkidle")
      const wcag = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
      expect(wcag.violations, `${theme} wcag`).toEqual([])
      const best = await new AxeBuilder({ page }).withTags(["best-practice"]).analyze()
      expect(
        best.violations.filter((v) => STRUCTURE_RULES.includes(v.id)),
        `${theme} structure`
      ).toEqual([])
    })
  }
})
