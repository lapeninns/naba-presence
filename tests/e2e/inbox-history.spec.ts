import { expect, test } from "@playwright/test"
import postgres from "postgres"

import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "../integration/helpers/tenant"

// WP-08 / W2-02 (docs/audits/2026-10-14-full-stack-audit): the reply
// composer filled its box from an effect, so opening a review that already
// had a reply committed one render with an empty box: dirty. The leave
// guard armed on it and pushed a sentinel history entry, so every review
// opened left one more entry for Back to walk through.
//
// Its own tenant, with three reviews that each carry a live reply (the
// journey tenant's reviews have none to seed), destroyed afterwards.
const historyTest = test.extend<{ cookie: string }>({
  // Playwright requires the first fixture argument to be destructured.
  cookie: async ({}, provide) => {
    const url = process.env.DIRECT_DATABASE_URL
    if (!url) {
      throw new Error(
        "DIRECT_DATABASE_URL (the harness database) is required to seed the inbox history tenant."
      )
    }
    const admin = postgres(url, { max: 1 })
    const tenant = await createTestTenant(admin)
    try {
      const connection = await seedGoogleConnection(admin, {
        organisationId: tenant.organisationId,
      })
      for (const text of ["First stay", "Second stay", "Third stay"]) {
        await seedLinkedReview(admin, {
          organisationId: tenant.organisationId,
          connectionId: connection.connectionId,
          googleAccountName: connection.googleAccountName,
          text,
          rating: 5,
          replyState: "APPROVED",
        })
      }
      await provide(tenant.cookie)
    } finally {
      await destroyTenants(admin, [tenant.organisationId])
      await admin.end()
    }
  },
})

historyTest.describe("inbox history", () => {
  historyTest(
    "opening reviews with live replies adds no history entries",
    async ({ baseURL, cookie, page }) => {
      const [name, value] = cookie.split("=", 2)
      await page.context().addCookies([{ name, value, url: baseURL! }])
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto("/inbox?queue=all")
      const rows = page.locator('[data-slot="review-row"]')
      await expect(rows).toHaveCount(3)
      await expect(page).toHaveURL(/selected=/)
      const box = page.getByRole("textbox", { name: "Your reply" })
      await expect(box).toHaveValue("Existing provider reply")
      await page.waitForLoadState("networkidle")

      const before = await page.evaluate(() => window.history.length)
      for (const index of [2, 1, 0, 2, 1]) {
        const row = rows.nth(index)
        await row.click()
        await expect(row).toHaveAttribute("aria-current", "true")
        await expect(box).toHaveValue("Existing provider reply")
      }
      expect(await page.evaluate(() => window.history.length)).toBe(before)
    }
  )
})
