import { expect, test } from "@playwright/test"

test("locations index lists linked locations", async ({ page }) => {
  await page.goto("/locations")

  await expect(
    page.getByRole("heading", { name: "Locations", level: 1 })
  ).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "Location" })).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible()
})
