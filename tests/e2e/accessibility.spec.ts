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

async function openNavigationSurface(page: Page, name: string) {
  const mobileMenu = page.getByRole("button", { name: "Open navigation" })
  const mobile = await mobileMenu.isVisible()
  if (mobile) await mobileMenu.click()
  await page.getByRole("button", { name, exact: true }).click()
  if (mobile) {
    await expect(page.getByRole("dialog", { name: "Navigation" })).toBeHidden()
  }
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test.describe(`${viewport.name} WCAG 2.2 AA`, () => {
    test.use({ viewport })

    test("inbox, review detail, and reply editor", async ({ page }) => {
      await page.goto("/")
      if (viewport.name === "mobile") {
        const row = page.getByRole("button", { name: /Alice Morgan/ }).first()
        await expect(row).toBeVisible()
        await expectAccessible(page, "mobile review inbox")
        await row.click()
      }
      await expect(
        page.getByRole("heading", { name: "Alice Morgan" }).first()
      ).toBeVisible()
      await expectAccessible(page, `${viewport.name} review detail and editor`)
    })

    test("connections", async ({ page }) => {
      await page.goto("/")
      await openNavigationSurface(page, "Connections")
      await expect(
        page.getByRole("heading", { name: "Google connection" })
      ).toBeVisible()
      await expectAccessible(page, `${viewport.name} connections`)
    })

    test("settings", async ({ page }) => {
      await page.goto("/")
      await openNavigationSurface(page, "Settings")
      await expect(
        page.getByRole("heading", { name: "Reply policy" })
      ).toBeVisible()
      await expectAccessible(page, `${viewport.name} settings`)
    })
  })
}
