import { expect, test } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

import { startOperationsBackend } from "./helpers/operations-backend"

let backend: Awaited<ReturnType<typeof startOperationsBackend>>
test.beforeAll(async () => {
  backend = await startOperationsBackend()
})
test.afterAll(async () => {
  await backend.stop()
})
test.beforeEach(async ({ context }) => {
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === backend.server.baseUrl
      ? route.continue()
      : route.abort("blockedbyclient")
  )
})

// INB-05 (D2, 0149). The approval kinds are addressed: a row shows only to
// the people named in notification_incident_recipient, owners included.
for (const width of [375, 768, 1280])
  test.describe(`Approval notifications at ${width}px`, () => {
    test.use({ viewport: { width, height: 1100 } })

    test("shows the owner only the approval notifications addressed to them", async ({
      page,
    }, info) => {
      const f = await backend.fixture(page)
      const locationId = f.linked[0].locationId
      const addressed = async (
        kind: "approval_requested" | "reply_sent_back",
        recipient: string | null
      ) => {
        const reviewId = crypto.randomUUID()
        const [row] = await backend.admin<{ id: string }[]>`
          insert into notification_incident (organisation_id, kind, subject_type, subject_id, summary, location_id)
          values (${f.owner.organisationId}, ${kind}, 'review',
            ${`${f.owner.organisationId}:review:${reviewId}`},
            ${backend.admin.json({ title: "Fixture Inn 1", locationId, reviewId })}, ${locationId})
          returning id::text as id`
        if (recipient)
          await backend.admin`
            insert into notification_incident_recipient (organisation_id, incident_id, user_id)
            values (${f.owner.organisationId}, ${row.id}, ${recipient})`
      }
      await addressed("approval_requested", f.owner.userId)
      // Addressed to nobody here (as if to another person): never shown.
      await addressed("reply_sent_back", null)

      await f.goto("/notifications")
      await expect(
        page.getByRole("status").filter({ hasText: "1 open and unread" })
      ).toBeVisible()
      await expect(
        page.getByText("Approval requested", { exact: true })
      ).toBeVisible()
      await expect(
        page.getByText("Reply sent back", { exact: true })
      ).toHaveCount(0)
      // It clears when the reply is decided, so nobody resolves it by hand.
      await expect(
        page.getByRole("button", { name: /^Resolve: Approval requested/ })
      ).toHaveCount(0)
      await expect(
        page.getByRole("link", {
          name: "Open listing for Approval requested",
        })
      ).toHaveAttribute("href", `/listings/${locationId}`)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true)
      const axe = await new AxeBuilder({ page }).include("main").analyze()
      expect(axe.violations).toEqual([])
      await page.screenshot({
        path: info.outputPath(`approval-notifications-${width}.png`),
        animations: "disabled",
      })
    })
  })
