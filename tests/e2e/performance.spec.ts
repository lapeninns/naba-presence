import { expect, test } from "@playwright/test"

test("performance exposes reply and Google tabs", async ({ page }) => {
  await page.goto("/performance")

  await expect(page).toHaveURL("/performance")
  await expect(
    page.getByRole("heading", { name: "Performance", level: 1 })
  ).toBeVisible()
  await expect(
    page.getByRole("tab", { name: "Reply performance" })
  ).toBeVisible()
  await expect(
    page.getByRole("tab", { name: "Google performance" })
  ).toBeVisible()
})

test("analytics redirects to performance", async ({ page }) => {
  await page.goto("/analytics")

  await expect(page).toHaveURL("/performance")
})
