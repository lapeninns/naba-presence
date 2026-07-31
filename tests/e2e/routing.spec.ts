import { expect, test } from "@playwright/test"

const dashboardRoutes = [
  { path: "/home", label: "Home", heading: /^Home$/ },
  { path: "/inbox", label: "Inbox", heading: /^Inbox$/ },
  { path: "/performance", label: "Performance", heading: /^Performance$/ },
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

test("root redirects to home", async ({ page }) => {
  await page.goto("/")

  await expect(page).toHaveURL("/home")
  await expect(
    page.getByRole("heading", { name: "Home", level: 1 })
  ).toBeVisible()
})

test("legacy routes redirect to their replacements", async ({ page }) => {
  for (const [from, to] of [
    ["/overview", "/home"],
    ["/reviews", "/inbox"],
    ["/analytics", "/performance"],
    ["/connections", "/settings/connections"],
  ]) {
    await page.goto(from)
    await expect(page).toHaveURL(to)
  }
})

test("sidebar links update browser history", async ({ page }) => {
  await page.goto("/inbox")

  await page.getByRole("link", { name: "Home", exact: true }).click()
  await expect(page).toHaveURL("/home")

  await page.getByRole("link", { name: "Settings", exact: true }).click()
  await expect(page).toHaveURL("/settings")

  await page.goBack()
  await expect(page).toHaveURL("/home")
})
