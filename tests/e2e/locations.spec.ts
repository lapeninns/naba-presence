import { expect, test } from "@playwright/test"

test("locations index lists linked locations", async ({ page }) => {
  await page.goto("/locations")

  await expect(
    page.getByRole("heading", { name: "Locations", level: 1 })
  ).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "Location" })).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible()
})

test("location workspace exposes capability tabs", async ({ page }) => {
  await page.goto("/locations")
  await page.getByRole("table").getByRole("link").first().click()

  await expect(page).toHaveURL(/\/locations\/[0-9a-f-]+$/)
  const locationSections = page.getByRole("navigation", {
    name: "Location sections",
  })
  await expect(
    locationSections.getByRole("link", { name: "Profile" })
  ).toBeVisible()
  await expect(
    locationSections.getByRole("link", { name: "Reviews" })
  ).toBeVisible()
  await expect(
    locationSections.getByRole("link", { name: "Hours" })
  ).toBeVisible()
})
