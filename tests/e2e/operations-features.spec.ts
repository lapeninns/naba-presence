import { expect, test, type Page, type TestInfo } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

import { startOperationsBackend } from "./helpers/operations-backend"
import { captureServicesPanel } from "./helpers/services-capture"

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

async function capture(
  page: Page,
  info: TestInfo,
  name: string,
  scope = "main"
) {
  await captureServicesPanel(page, info, name, scope)
}
async function dialogCapture(page: Page, info: TestInfo, name: string) {
  // Axe must see the settled dialog, not its opening fade.
  await page.waitForFunction(() =>
    [
      ...document.querySelectorAll(
        '[role="dialog"], [data-slot="dialog-overlay"], [data-slot="sheet-overlay"]'
      ),
    ].every((element) => getComputedStyle(element).opacity === "1")
  )
  expect(
    (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
      .violations
  ).toEqual([])
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    animations: "disabled",
  })
}
/** The last Sunday of October on or after today: London's autumn clock change. */
function autumnChange() {
  const now = new Date()
  for (const year of [now.getUTCFullYear(), now.getUTCFullYear() + 1]) {
    const last = new Date(Date.UTC(year, 9, 31))
    const sunday = new Date(last.getTime() - last.getUTCDay() * 86_400_000)
    if (sunday.getTime() - 86_400_000 > now.getTime())
      return sunday.toISOString().slice(0, 10)
  }
  throw new Error("no autumn change")
}
const dayBefore = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10)
const nextDecember = () =>
  `${new Date().getUTCMonth() === 11 && new Date().getUTCDate() >= 24 ? new Date().getUTCFullYear() + 1 : new Date().getUTCFullYear()}-12-24`

for (const width of [375, 768, 1280])
  test.describe(`Operations features at ${width}px`, () => {
    test.use({ viewport: { width, height: 1100 } })

    test("reads notifications without resolving them, resolves an event and saves preferences", async ({
      page,
    }, info) => {
      const f = await backend.fixture(page)
      const failed = await f.incident(
        "publication_failed",
        f.linked[0].locationId
      )
      await f.incident("connection_reconnect", null)
      await f.goto("/notifications")
      await expect(
        page.getByRole("status").filter({ hasText: "2 open and unread" })
      ).toBeVisible()
      await expect(
        page.getByRole("link", { name: "Notifications, 2 unread" })
      ).toBeVisible()
      await capture(page, info, "notifications-unread")
      await page
        .getByRole("button", { name: "Mark read: Publishing failed" })
        .click()
      await expect(
        page.getByRole("button", { name: "Mark unread: Publishing failed" })
      ).toBeVisible()
      const [row] =
        await backend.admin`select status from notification_incident where id = ${failed}`
      expect(row.status).toBe("open")
      await expect(
        page.getByRole("button", { name: /^Resolve: Google login/ })
      ).toHaveCount(0)
      await page
        .getByRole("button", { name: "Resolve: Publishing failed" })
        .click()
      await expect(
        page.getByText("Resolved", { exact: true }).first()
      ).toBeVisible()
      await capture(page, info, "notifications-resolved")
      await f.goto("/settings/notifications")
      const toggle = page.getByRole("switch", {
        name: "In app: Scheduled post missed",
      })
      await expect(toggle).toBeChecked()
      await toggle.click()
      await expect(toggle).not.toBeChecked()
      await expect(
        page.getByText("Email is not set up", { exact: true })
      ).toBeVisible()
      await capture(page, info, "notification-preferences")
      const [saved] =
        await backend.admin`select mode from notification_preference where organisation_id = ${f.owner.organisationId} and event_kind = 'schedule_missed' and channel = 'in_app'`
      expect(saved.mode).toBe("off")
    })

    test("shows operational health with guarded recovery only", async ({
      page,
    }, info) => {
      const f = await backend.fixture(page)
      await f.goto("/settings/operations")
      for (const heading of [
        "Scheduler",
        "Sync freshness",
        "Queued work",
        "Unresolved Google writes",
        "Notification email",
        "Review notification failures",
      ]) {
        await expect(
          page.getByRole("heading", { name: heading, exact: true })
        ).toBeVisible()
      }
      // Scheduler rows carry readable names and the schedule each is judged
      // against, never the internal tick keys.
      const jobs = page.getByRole("list", { name: "Scheduled jobs" })
      for (const label of [
        "Job runner",
        "Review check",
        "Listing sync",
        "Performance metrics",
        "Full review sweep",
        "Search keywords",
        "Data retention clean-up",
        "Health checks",
      ]) {
        await expect(jobs.getByText(label, { exact: true })).toBeVisible()
      }
      for (const key of ["jobs", "presence-resources", "retention"]) {
        await expect(jobs.getByText(key, { exact: true })).toHaveCount(0)
      }
      await expect(
        jobs.getByText(
          "Expected every minute · stale after 5 minutes without a run"
        )
      ).toBeVisible()
      await expect(
        page.getByRole("button", { name: /Retry .*failed email/ })
      ).toBeDisabled()
      await capture(page, info, "operations-view")
    })

    test("schedules a post across a clock change, approves it and shows it in the calendar", async ({
      page,
    }, info) => {
      const f = await backend.fixture(page, 1)
      const created = await page.request.post(
        `${backend.server.baseUrl}/api/locations/${f.linked[0].locationId}/posts`,
        {
          data: {
            topicType: "STANDARD",
            languageCode: "en-GB",
            summary: "Autumn menu launch",
            media: [],
          },
        }
      )
      expect(created.status()).toBe(201)
      await f.goto(`/listings/${f.linked[0].locationId}/posts`)
      await page
        .getByRole("button", {
          name: "Schedule publication: Autumn menu launch",
        })
        .click()
      const sheet = page.getByRole("dialog", {
        name: "Schedule publication",
        exact: true,
      })
      await sheet.getByRole("tab", { name: "Daily", exact: true }).click()
      await sheet.getByLabel("Starting").fill(dayBefore(autumnChange()))
      await sheet.getByLabel("Local time").fill("01:30")
      await sheet.getByLabel("Times").fill("3")
      await expect(
        sheet
          .getByText(
            /Clocks go back: this time happens twice that day, so it runs once, at the earlier of the two/
          )
          .first()
      ).toBeVisible()
      await dialogCapture(page, info, "schedule-preview")
      await sheet
        .getByRole("button", {
          name: "Submit schedule for approval",
          exact: true,
        })
        .click()
      await expect(
        page.getByText("Awaiting approval", { exact: true })
      ).toBeVisible()
      expect(backend.posts).toHaveLength(0)
      await page
        .getByRole("button", { name: "Review schedule", exact: true })
        .click()
      const review = page.getByRole("dialog", {
        name: "Approve publication schedule",
        exact: true,
      })
      await expect(review.getByText(/falls? on a clock change/)).toBeVisible()
      await dialogCapture(page, info, "schedule-approval")
      await review
        .getByRole("button", { name: "Approve schedule", exact: true })
        .click()
      await expect(page.getByText("Active", { exact: true })).toBeVisible()
      await capture(
        page,
        info,
        "schedule-active",
        '[aria-labelledby="post-schedules"]'
      )
      const [{ count }] =
        await backend.admin`select count(*)::int as count from post_publication_occurrence o join post_publication_schedule s on s.id = o.schedule_id where s.location_id = ${f.linked[0].locationId}`
      expect(count).toBe(3)
      await f.goto("/calendar")
      await page.getByRole("tab", { name: "Agenda", exact: true }).click()
      for (let step = 0; step < 14; step += 1) {
        // Wait for this period's answer before deciding to move on.
        await expect(
          page
            .getByText(/No scheduled publications in this period|Fixture Inn 1/)
            .first()
        ).toBeVisible()
        if (await page.getByText("Fixture Inn 1").first().isVisible()) break
        await page.getByRole("button", { name: "Next period" }).click()
      }
      await expect(
        page.getByRole("list", { name: "Scheduled publications" })
      ).toBeVisible()
      await capture(page, info, "calendar-agenda")
      await page.getByRole("tab", { name: "Month", exact: true }).click()
      await expect(page.getByRole("table")).toBeVisible()
      await capture(page, info, "calendar-month")
    })

    test("prepares, approves and runs a bulk special-hours change with per-listing confirmation", async ({
      page,
    }, info) => {
      const f = await backend.fixture(page, 2)
      await f.goto("/listings")
      await page
        .getByRole("checkbox", {
          name: "Select Fixture Inn 1 for a bulk change",
        })
        .check()
      await page
        .getByRole("checkbox", {
          name: "Select Fixture Inn 2 for a bulk change",
        })
        .check()
      await expect(
        page.getByRole("region", { name: "Bulk change selection" })
      ).toContainText("2 selected")
      await capture(page, info, "bulk-selection")
      await page
        .getByRole("link", { name: "Prepare bulk change", exact: true })
        .click()
      await page.getByLabel("Date", { exact: true }).fill(nextDecember())
      await capture(page, info, "bulk-compose")
      await page
        .getByRole("button", { name: "Preview this change", exact: true })
        .click()
      await expect(
        page.getByText("Waiting for approval.", { exact: false })
      ).toBeVisible()
      expect(
        backend.google.calls.filter((call) => call.method === "PATCH")
      ).toHaveLength(0)
      await capture(page, info, "bulk-preview")
      await page
        .getByRole("button", { name: "Approve this exact change", exact: true })
        .click()
      await page
        .getByRole("button", { name: "Start bulk change", exact: true })
        .click()
      await expect(page.getByText(/Running\./)).toBeVisible()
      await backend.tick()
      await page.reload()
      await expect(
        page.getByText("Every eligible listing is confirmed.", { exact: false })
      ).toBeVisible()
      await expect(page.getByText("Confirmed", { exact: true })).toHaveCount(2)
      await capture(page, info, "bulk-confirmed")
      expect(
        backend.google.calls.filter((call) => call.method === "PATCH")
      ).toHaveLength(2)
    })

    test("reports missing Google figures as no data with coverage and fetch provenance", async ({
      page,
    }, info) => {
      const f = await backend.fixture(page, 2)
      const recent = new Date(Date.now() - 2 * 86_400_000)
        .toISOString()
        .slice(0, 10)
      await backend.admin`insert into performance_metric_daily (organisation_id, external_location_id, metric, metric_date, value) values (${f.owner.organisationId}, ${f.linked[0].externalLocationId}, 'WEBSITE_CLICKS', ${recent}::date, 7)`
      await backend.admin`insert into sync_checkpoint (organisation_id, external_location_id, sync_type, status, next_attempt_at, last_succeeded_at) values (${f.owner.organisationId}, ${f.linked[0].externalLocationId}, 'performance', 'succeeded', now(), now() - interval '1 hour')`
      await f.goto("/reports?tab=google")
      await expect(
        page.getByText("No data", { exact: true }).first()
      ).toBeVisible()
      await expect(page.getByText(/1 of 2 locations reporting/)).toBeVisible()
      await expect(
        page.getByText(/Data through .*Google’s daily dates/)
      ).toBeVisible()
      await expect(
        page.getByRole("button", {
          name: "Download Google profile totals as CSV",
        })
      ).toBeVisible()
      await capture(page, info, "reports-provenance")
    })
  })
