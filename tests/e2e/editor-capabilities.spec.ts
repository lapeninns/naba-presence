import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

import { readJourneyState } from "./helpers/stub-bridge"

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  for (const reconnect of [true, false]) {
    test(`hours ${reconnect ? "reconnect gate" : "verification advisory"} preserves local editing at ${viewport.width}px`, async ({
      page,
      baseURL,
    }, testInfo) => {
      await page.setViewportSize(viewport)
      const state = (await readJourneyState()).editorCapabilities
      const [name, value] = state.cookie.split("=", 2)
      await page.context().addCookies([{ name, value, url: baseURL! }])
      const locationId = reconnect
        ? state.reconnectLocationId
        : state.unverifiedLocationId
      const publishRequests: string[] = []
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          request.url().includes(`/api/locations/${locationId}/`)
        )
          publishRequests.push(request.url())
      })
      await page.goto(`/listings/${locationId}/hours`)
      const banner = page.locator('[data-slot="capability-banner"]')
      await expect(banner).toHaveAttribute(
        "data-tone",
        reconnect ? "blocked" : "warning"
      )
      await expect(banner).toContainText(
        reconnect
          ? "The Google login for this listing needs reconnecting"
          : "Google verification isn’t confirmed for this listing"
      )
      if (!reconnect) {
        await expect(
          page.getByText("Hours changed on Google", { exact: true })
        ).toBeVisible()
        await expect(
          page.getByRole("button", { name: "Keep Google’s hours", exact: true })
        ).toBeEnabled()
      }
      await expect(banner).toContainText(
        reconnect
          ? "You can keep editing and save here"
          : "You can keep editing, save here and submit changes to Google"
      )
      const monday = page.getByRole("switch", { name: "Monday open" })
      await expect(monday).toBeEnabled()
      await monday.click()
      if (viewport.width < 768) {
        await page
          .getByRole("region", { name: "Editor actions" })
          .getByRole("button", { name: "More actions" })
          .click()
        await expect(
          page.getByRole("menuitem", { name: "Save here", exact: true })
        ).toBeEnabled()
        await page.keyboard.press("Escape")
      } else {
        await expect(
          page.getByRole("button", { name: "Save here", exact: true })
        ).toBeEnabled()
      }
      const review = page.getByRole("button", {
        name: "Review changes",
        exact: true,
      })
      if (reconnect) await expect(review).toBeDisabled()
      else await expect(review).toBeEnabled()
      const accessibility = await new AxeBuilder({ page })
        .include('[data-slot="capability-banner"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze()
      expect(accessibility.violations).toEqual([])
      await banner.screenshot({
        path: testInfo.outputPath("capability-banner.png"),
      })
      expect(publishRequests).toEqual([])
    })
  }
}
