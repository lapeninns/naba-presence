import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

const accessibilityTags = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
]

async function expectAccessible(page: Page, surface: string) {
  const results = await new AxeBuilder({ page })
    .withTags(accessibilityTags)
    .analyze()
  expect(
    results.violations,
    `${surface} accessibility violations:\n${results.violations
      .map(
        (violation) =>
          `${violation.id}: ${violation.help} (${violation.nodes.length} nodes)`
      )
      .join("\n")}`
  ).toEqual([])
}

async function openNavigationSurface(page: Page, name: string, mobile: boolean) {
  if (mobile) {
    await page.getByRole("button", { name: "Toggle navigation" }).click()
  }
  await page.getByRole("button", { name, exact: true }).click()
  if (mobile) {
    await expect(page.getByRole("dialog", { name: "Sidebar" })).toBeHidden()
  }
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test.describe(`${viewport.name} WCAG 2.2 AA`, () => {
    test.use({ viewport })

    test("application shell", async ({ page }) => {
      await page.goto("/")
      if (viewport.name === "desktop") {
        await expect(page.locator('[data-variant="floating"]')).toBeVisible()
      } else {
        await page.getByRole("button", { name: "Toggle navigation" }).click()
        await expect(
          page.getByRole("dialog", { name: "Sidebar" })
        ).toBeVisible()
      }
      await expect(
        page.getByRole("navigation", { name: "Primary" })
      ).toBeVisible()
      if (viewport.name === "mobile") {
        await page.waitForTimeout(350)
      }
      await expectAccessible(page, `${viewport.name} application shell`)
    })

    test("inbox, review detail, and reply editor", async ({ page }) => {
      await page.goto("/")
      const row = page
        .getByRole("region", { name: "Review list" })
        .getByRole("button")
        .first()
      await expect(row).toBeVisible()
      if (viewport.name === "mobile") {
        await expectAccessible(page, "mobile review inbox")
        await row.click()
      }
      await expect(
        page
          .getByRole("region", { name: "Selected review" })
          .getByRole("heading")
          .first()
      ).toBeVisible()
      await expectAccessible(page, `${viewport.name} review detail and editor`)
    })

    test("connections", async ({ page }) => {
      await page.goto("/")
      await openNavigationSurface(page, "Connections", viewport.name === "mobile")
      await expect(
        page.getByRole("heading", { name: "Google Business Profile" })
      ).toBeVisible()
      await expectAccessible(page, `${viewport.name} connections`)
    })

    test("settings", async ({ page }) => {
      await page.goto("/")
      await openNavigationSurface(page, "Settings", viewport.name === "mobile")
      await expect(
        page.getByRole("heading", { name: "Reply policy" })
      ).toBeVisible()
      await expectAccessible(page, `${viewport.name} settings`)
    })
  })
}
