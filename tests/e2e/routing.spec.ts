import { expect, test } from "@playwright/test"

const dashboardRoutes = [
  { path: "/reviews", label: "Reviews", heading: /^Reviews$/ },
  {
    path: "/overview",
    label: "Overview",
    heading: /^Good (morning|afternoon|evening),/,
  },
  { path: "/analytics", label: "Analytics", heading: /^Analytics$/ },
  {
    path: "/connections",
    label: "Connections",
    heading: /^(Connect )?Google Business Profile$/,
  },
  { path: "/settings", label: "Settings", heading: /^Reply policy$/ },
]

test("dashboard pages have direct URLs", async ({ page }) => {
  for (const route of dashboardRoutes) {
    await page.goto(route.path)
    await expect(page).toHaveURL(route.path)
    await expect(
      page.getByRole("heading", { name: route.heading, level: 1 })
    ).toBeVisible()
    await expect(
      page.getByRole("link", { name: route.label, exact: true })
    ).toHaveAttribute("aria-current", "page")
  }
})

test("root redirects to the review inbox", async ({ page }) => {
  await page.goto("/")

  await expect(page).toHaveURL("/reviews")
  await expect(
    page.getByRole("heading", { name: "Reviews", level: 1 })
  ).toBeVisible()
})

test("sidebar links update browser history", async ({ page }) => {
  await page.goto("/reviews")

  await page.getByRole("link", { name: "Overview", exact: true }).click()
  await expect(page).toHaveURL("/overview")

  await page.getByRole("link", { name: "Settings", exact: true }).click()
  await expect(page).toHaveURL("/settings")

  await page.goBack()
  await expect(page).toHaveURL("/overview")
})
