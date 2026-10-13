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
/**
 * Moves focus with Tab only until the control named `name` has it, so the
 * path is the one a keyboard user takes, then presses Enter on it.
 */
async function tabToAndPress(page: Page, name: string, limit = 150) {
  for (let step = 0; step < limit; step += 1) {
    await page.keyboard.press("Tab")
    const focused = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null
      return element?.textContent?.replace(/\s+/g, " ").trim() ?? ""
    })
    if (focused === name) {
      await page.keyboard.press("Enter")
      return
    }
  }
  throw new Error(`Tab never reached "${name}"`)
}
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
      // Resolving closes it for everyone and cannot be reopened: it asks.
      await page
        .getByRole("button", { name: "Yes, resolve: Publishing failed" })
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
      // Scheduling, and repeating schedules on top, are organisation
      // features that ship off (P08-R1).
      await backend.admin`
        insert into organisation_feature (organisation_id, feature, enabled, changed_by)
        values (${f.owner.organisationId}, 'post_scheduling', true, 'e2e'),
          (${f.owner.organisationId}, 'post_scheduling_recurring', true, 'e2e')
        on conflict (organisation_id, feature) do update set enabled = true`
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

    test("schedules a post once, cancels it, and reviews an old post time (P08-R5)", async ({
      page,
    }, info) => {
      const f = await backend.fixture(page, 1)
      // CSS, not a role query: on a phone the sidebar is in the page but
      // hidden, and a role query would not count it either way.
      const calendarLink = page.locator(
        'nav[aria-label="Primary"] a[href^="/calendar"]'
      )
      // Off (the default): no scheduling anywhere, Calendar included.
      const created = await page.request.post(
        `${backend.server.baseUrl}/api/locations/${f.linked[0].locationId}/posts`,
        {
          data: {
            topicType: "STANDARD",
            languageCode: "en-GB",
            summary: "Harvest supper club",
            media: [],
          },
        }
      )
      expect(created.status()).toBe(201)
      const postId = ((await created.json()) as { post: { id: string } }).post
        .id
      await f.goto(`/listings/${f.linked[0].locationId}/posts`)
      await expect(
        page.getByRole("button", { name: "Publish", exact: true })
      ).toBeVisible()
      await expect(
        page.getByRole("button", { name: /^Schedule publication/ })
      ).toHaveCount(0)
      await expect(calendarLink).toHaveCount(0)

      // On: Publish now or Schedule, one time only.
      await backend.admin`
        insert into organisation_feature (organisation_id, feature, enabled, changed_by)
        values (${f.owner.organisationId}, 'post_scheduling', true, 'e2e')
        on conflict (organisation_id, feature) do update set enabled = true`
      const oldTime = new Date(Date.now() + 3 * 86_400_000)
      oldTime.setUTCHours(18, 0, 0, 0)
      const legacyPost = await page.request.post(
        `${backend.server.baseUrl}/api/locations/${f.linked[0].locationId}/posts`,
        {
          data: {
            topicType: "STANDARD",
            languageCode: "en-GB",
            summary: "Bonfire night",
            media: [],
          },
        }
      )
      const legacyPostId = (
        (await legacyPost.json()) as { post: { id: string } }
      ).post.id
      await backend.admin`
        insert into gbp_local_post_legacy_schedule (organisation_id, location_id, post_id, scheduled_publish_time)
        values (${f.owner.organisationId}, ${f.linked[0].locationId}, ${legacyPostId}, ${oldTime})`
      await page.reload()
      await expect(calendarLink).toHaveCount(1)
      await expect(
        page.getByRole("button", { name: "Publish now" }).first()
      ).toBeVisible()
      await page
        .getByRole("button", {
          name: "Schedule publication: Harvest supper club",
        })
        .click()
      const sheet = page.getByRole("dialog", {
        name: "Schedule publication",
        exact: true,
      })
      await expect(
        sheet.getByRole("tablist", { name: "How often" })
      ).toHaveCount(0)
      await expect(sheet.getByText(/1 publication from now/)).toBeVisible()
      await dialogCapture(page, info, "schedule-once-preview")
      await sheet
        .getByRole("button", {
          name: "Submit schedule for approval",
          exact: true,
        })
        .click()
      const schedules = page.getByRole("region", {
        name: "Publication schedules",
      })
      await expect(
        schedules.getByText("Awaiting approval", { exact: true })
      ).toBeVisible()
      // The post says it is scheduled and is no longer offered Schedule.
      await expect(
        page.getByText(/Scheduled publication awaiting approval:/)
      ).toBeVisible()
      await expect(
        page.getByRole("button", {
          name: "Schedule publication: Harvest supper club",
        })
      ).toHaveCount(0)
      await capture(page, info, "schedule-once-awaiting")

      await schedules
        .getByRole("button", { name: "Cancel schedule", exact: true })
        .click()
      await expect(
        schedules.getByText("Cancelled", { exact: true })
      ).toBeVisible()
      await expect(
        page.getByRole("button", {
          name: "Schedule publication: Harvest supper club",
        })
      ).toBeVisible()
      const [schedule] = await backend.admin<
        { status: string; occurrences: number }[]
      >`select s.status, (select count(*)::int from post_publication_occurrence o where o.schedule_id = s.id) as occurrences
        from post_publication_schedule s where s.source_post_id = ${postId}`
      expect(schedule).toEqual({ status: "cancelled", occurrences: 0 })

      // The old per-post time: dismissed, not published.
      const review = page.getByRole("region", {
        name: "Old post times to review",
      })
      await expect(review.getByText(/Was set for/)).toBeVisible()
      await capture(
        page,
        info,
        "legacy-post-time",
        '[aria-labelledby="legacy-post-schedules"]'
      )
      await review
        .getByRole("button", { name: "Dismiss old time: Bonfire night" })
        .click()
      await expect(review).toHaveCount(0)
      expect(backend.posts).toHaveLength(0)
    })

    test("hides bulk changes from an organisation without the bulk_actions feature", async ({
      page,
    }) => {
      const f = await backend.fixture(page, 1)
      await f.goto("/listings")
      await expect(
        page.getByRole("link", { name: "Fixture Inn 1" }).first()
      ).toBeVisible()
      await expect(
        page.getByRole("checkbox", {
          name: "Select Fixture Inn 1 for a bulk change",
        })
      ).toHaveCount(0)
      // The dashboard's loading boundary streams first, so notFound()
      // renders the not-found page under a 200 rather than a 404 status.
      await f.goto(`/listings/bulk?ids=${f.linked[0].locationId}`)
      await expect(
        page.getByRole("heading", { name: "This page doesn’t exist" })
      ).toBeVisible()
      await expect(
        page.getByRole("button", { name: "Preview this change" })
      ).toHaveCount(0)
    })

    test("prepares, approves and runs a bulk special-hours change with per-listing confirmation", async ({
      page,
    }, info) => {
      const f = await backend.fixture(page, 2)
      await f.enableFeature("bulk_actions")
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
      await expect(page.getByText(/^Approve by /)).toBeVisible()
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
      // One real write per listing; bulk hours publish through the hours
      // editor's path, which validates first (`validateOnly=true`).
      expect(
        backend.google.calls.filter(
          (call) =>
            call.method === "PATCH" && !call.path.includes("validateOnly=true")
        )
      ).toHaveLength(2)
    })

    test("composes a bulk change list by keyboard, re-previews expired listings and shows each receipt", async ({
      page,
    }, info) => {
      const f = await backend.fixture(page, 2)
      await f.enableFeature("bulk_actions")
      await f.goto(
        `/listings/bulk?ids=${f.linked.map((entry) => entry.locationId).join(",")}`
      )
      const date = page.getByLabel("Date", { exact: true })
      await date.fill(nextDecember())
      await date.focus()
      await tabToAndPress(page, "Add to the batch")
      await date.fill(nextDecember().replace(/-24$/, "-31"))
      await date.focus()
      await tabToAndPress(page, "Add to the batch")
      const list = page.getByRole("list", {
        name: "Changes in this batch, in the order they are sent",
      })
      await expect(list.getByRole("listitem")).toHaveCount(2)
      await expect(
        page.getByText(/2 listings × 2 changes = 4 of at most 500/)
      ).toBeVisible()
      await capture(page, info, "bulk-compose-list")
      await date.focus()
      await tabToAndPress(page, "Preview these 2 changes")
      await expect(
        page.getByText("Waiting for approval.", { exact: false })
      ).toBeVisible()
      await expect(page.getByText(/^\d+:\d\d left$/)).toBeVisible()
      await capture(page, info, "bulk-preview-countdown")
      // The 15-minute approval window closes.
      await backend.admin`update bulk_listing_operation set preview_expires_at = now() - interval '1 second' where organisation_id = ${f.owner.organisationId}`
      await page.reload()
      await expect(page.getByText(/^This change expired\./)).toBeVisible()
      await expect(
        page.getByRole("button", { name: "Approve this exact change" })
      ).toHaveCount(0)
      await capture(page, info, "bulk-preview-expired")
      const expiredUrl = page.url()
      await page.locator("body").focus()
      await tabToAndPress(page, "New preview for 2 listings not sent")
      await expect(page).not.toHaveURL(expiredUrl)
      await expect(
        page.getByText("Waiting for approval.", { exact: false })
      ).toBeVisible()
      await page.locator("body").focus()
      await tabToAndPress(page, "Approve this exact change")
      await expect(
        page.getByRole("button", { name: "Start bulk change" })
      ).toBeVisible()
      await page.locator("body").focus()
      await tabToAndPress(page, "Start bulk change")
      await expect(page.getByText(/Running\./)).toBeVisible()
      // Each listing's two changes run in order, one at a time per listing.
      for (let tick = 0; tick < 4; tick += 1) {
        await backend.tick()
        const [row] = await backend.admin<{ count: number }[]>`
          select count(*)::int as count from bulk_listing_child c
          join bulk_listing_operation o on o.id = c.operation_id
          where o.organisation_id = ${f.owner.organisationId} and o.status <> 'expired' and c.status = 'succeeded'`
        if (row.count === 4) break
      }
      await page.reload()
      await expect(
        page.getByText("Every eligible listing is confirmed.", { exact: false })
      ).toBeVisible()
      await expect(page.getByText("Confirmed", { exact: true })).toHaveCount(4)
      await page.locator("body").focus()
      await tabToAndPress(page, "Show receipt for Fixture Inn 1")
      await expect(
        page.getByText(/^Receipt [0-9a-f-]{36}$/).first()
      ).toBeVisible()
      await expect(page.getByText("Live on Google").first()).toBeVisible()
      await capture(page, info, "bulk-receipt")
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
        // The visible "Download totals CSV" starts the accessible name
        // (WCAG 2.5.3, label in name); the subject follows it.
        page.getByRole("button", {
          name: "Download totals CSV of the Google profile",
        })
      ).toBeVisible()
      await capture(page, info, "reports-provenance")
    })
  })
