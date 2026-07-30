import { expect, test } from "@playwright/test"

test("inbox is the cross-location review queue", async ({ page }) => {
  await page.goto("/inbox")

  await expect(page).toHaveURL("/inbox")
  await expect(
    page.getByRole("heading", { name: "Inbox", level: 1 })
  ).toBeVisible()
  await expect(
    page.getByRole("combobox", { name: "Filter by location" })
  ).toBeVisible()
})

test("reviews redirects to inbox", async ({ page }) => {
  await page.goto("/reviews")

  await expect(page).toHaveURL("/inbox")
})
