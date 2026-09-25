import { expect, test } from "@playwright/test"

// Throwaway: a deliberate failure to prove CI uploads traces. Never merge.
test("ci probe: deliberate failure uploads a trace", async ({ page }) => {
  await page.goto("/sign-in")
  await expect(page.getByText("this text is deliberately absent")).toBeVisible({
    timeout: 2_000,
  })
})
