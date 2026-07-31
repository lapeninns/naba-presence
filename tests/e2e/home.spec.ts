import { expect, test } from "@playwright/test"

test("home renders the organisation roll-up", async ({ page }) => {
  await page.goto("/home")

  await expect(page).toHaveURL("/home")
  await expect(
    page.getByRole("heading", { name: "Home", level: 1 })
  ).toBeVisible()
  await expect(page.getByText("Average rating")).toBeVisible()
  await expect(page.getByText("Response rate")).toBeVisible()
})

test("overview redirects to home", async ({ page }) => {
  await page.goto("/overview")

  await expect(page).toHaveURL("/home")
})
