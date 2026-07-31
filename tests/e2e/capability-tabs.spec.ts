import { expect, test } from "@playwright/test"

const tabs = [
  { segment: "hours", capability: "Hours" },
  { segment: "photos", capability: "Photos" },
  { segment: "posts", capability: "Posts" },
  { segment: "menu", capability: "Menu" },
  { segment: "booking", capability: "Booking" },
  { segment: "performance", capability: "Performance" },
]

test("each unbuilt capability tab states its status", async ({ page }) => {
  await page.goto("/locations")
  if (new URL(page.url()).pathname === "/locations") {
    await page.getByRole("table").getByRole("link").first().click()
  }
  await page.waitForURL(/\/locations\/[0-9a-f-]+/)
  const base = new URL(page.url()).pathname

  for (const tab of tabs) {
    await page.goto(`${base}/${tab.segment}`)
    await expect(
      page.getByRole("heading", { name: tab.capability })
    ).toBeVisible()
    await expect(page.getByText("not enabled")).toBeVisible()
  }
})
