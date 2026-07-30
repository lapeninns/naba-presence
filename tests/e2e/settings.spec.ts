import { expect, test } from "@playwright/test"

const routes = [
  { path: "/settings", heading: /^Reply policy$/ },
  { path: "/settings/team", heading: /^Team access$/ },
  { path: "/settings/compliance", heading: /^Data and compliance$/ },
  { path: "/settings/connections", heading: /Google Business Profile$/ },
]

test("each settings area has its own URL", async ({ page }) => {
  for (const route of routes) {
    await page.goto(route.path)
    await expect(page).toHaveURL(route.path)
    await expect(
      page.getByRole("heading", { name: route.heading, level: 1 })
    ).toBeVisible()
  }
})

test("connections redirects under settings", async ({ page }) => {
  await page.goto("/connections")

  await expect(page).toHaveURL("/settings/connections")
})
