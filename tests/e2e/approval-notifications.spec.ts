import { expect, type Page, test } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

import { seedLinkedReview, seedMemberUser } from "../integration/helpers/tenant"
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

async function approvalFixture(page: Page) {
  const f = await backend.fixture(page, 0)
  const { organisationId } = f.owner
  const seed = { organisationId, ...f.connection }
  const [clientA, clientB] = await backend.admin<{ id: string }[]>`
    insert into client (organisation_id, name, slug)
    values
      (${organisationId}, 'Approval Hospitality', 'approval-hospitality'),
      (${organisationId}, 'Returned Hospitality', 'returned-hospitality')
    returning id::text as id`
  const approval = {
    ...(await seedLinkedReview(backend.admin, {
      ...seed,
      text: "Please approve the reply to this review.",
    })),
    text: "Please approve the reply to this review.",
  }
  const sentBack = {
    ...(await seedLinkedReview(backend.admin, {
      ...seed,
      text: "The reply to this review needs another edit.",
    })),
    text: "The reply to this review needs another edit.",
  }
  const otherReview = await seedLinkedReview(backend.admin, {
    ...seed,
    text: "A notification addressed to another person.",
  })
  // These are navigation fixtures, not an approval-lifecycle test. Give the
  // reviews the states their notifications describe so the queues are real.
  await backend.admin`
    update review set workflow_status = 'awaiting_approval'
    where id = ${approval.reviewId}`
  await backend.admin`
    update review set workflow_status = 'drafted'
    where id = ${sentBack.reviewId}`
  for (const [review, client] of [
    [approval, clientA],
    [sentBack, clientB],
    [otherReview, clientB],
  ] as const)
    await backend.admin`
      update location set client_id = ${client.id} where id = ${review.locationId}`

  const addressed = async (
    kind: "approval_requested" | "reply_sent_back",
    review: { reviewId: string; locationId: string },
    title: string,
    recipient: string
  ) => {
    const { reviewId, locationId } = review
    const [row] = await backend.admin<{ id: string }[]>`
      insert into notification_incident (organisation_id, kind, subject_type, subject_id, summary, location_id)
      values (${organisationId}, ${kind}, 'review',
        ${`${organisationId}:review:${reviewId}`},
        ${backend.admin.json({ title, locationId, reviewId })}, ${locationId})
      returning id::text as id`
    await backend.admin`
      insert into notification_incident_recipient (organisation_id, incident_id, user_id)
      values (${organisationId}, ${row.id}, ${recipient})`
  }
  await addressed(
    "approval_requested",
    approval,
    "Approval Inn",
    f.owner.userId
  )
  await addressed("reply_sent_back", sentBack, "Returned Inn", f.owner.userId)
  const otherPerson = await seedMemberUser(backend.admin, { organisationId })
  await addressed(
    "reply_sent_back",
    otherReview,
    "Other recipient Inn",
    otherPerson.userId
  )

  // A real, visible second client makes this a remembered-scope mismatch:
  // the approval belongs to A, while the shell starts with B remembered.
  await page
    .context()
    .addCookies([
      { name: "np_client", value: clientB.id, url: backend.server.baseUrl },
    ])
  const notificationState = () => backend.admin<
    { id: string; status: string; readAt: Date | null }[]
  >`
    select i.id::text as id, i.status, s.read_at as "readAt"
    from notification_incident i
    left join notification_recipient_state s
      on s.incident_id = i.id and s.user_id = ${f.owner.userId}
    where i.organisation_id = ${organisationId}
    order by i.id`
  return { ...f, approval, sentBack, clientB, notificationState }
}

// INB-05 (D2, 0149). Approval notifications are addressed: even owners see
// only their own. Opening the real review does not mark read or resolve it.
for (const width of [375, 768, 1280])
  test.describe(`Approval notifications at ${width}px`, () => {
    test.use({ viewport: { width, height: 1100 } })

    test("opens each addressed review in its queue without changing notification state", async ({
      page,
    }, info) => {
      const f = await approvalFixture(page)
      await f.goto("/notifications?filter=unread")
      const list = page.getByRole("list", {
        name: "Notifications",
        exact: true,
      })
      const assertUnreadRows = async () => {
        await expect(
          page.getByRole("status").filter({ hasText: "2 open and unread" })
        ).toBeVisible()
        await expect(list.getByRole("listitem")).toHaveCount(2)
        await expect(
          list.getByText("Approval requested", { exact: true })
        ).toBeVisible()
        await expect(
          list.getByText("Reply sent back", { exact: true })
        ).toBeVisible()
        await expect(
          list.getByText("Other recipient Inn", { exact: true })
        ).toHaveCount(0)
        await expect(list.getByText("Open", { exact: true })).toHaveCount(2)
        for (const label of ["Approval requested", "Reply sent back"]) {
          await expect(
            list.getByRole("button", {
              name: `Mark read: ${label}`,
              exact: true,
            })
          ).toBeVisible()
          // Only deciding the reply clears these conditions.
          await expect(
            list.getByRole("button", { name: `Resolve: ${label}`, exact: true })
          ).toHaveCount(0)
        }
      }
      await assertUnreadRows()
      const before = await f.notificationState()
      expect(before).toHaveLength(3)
      expect(
        before.every((row) => row.status === "open" && row.readAt === null)
      ).toBe(true)
      for (const [label, href] of [
        [
          "Approval requested",
          `/inbox?queue=approval&selected=${f.approval.reviewId}`,
        ],
        ["Reply sent back", `/inbox?selected=${f.sentBack.reviewId}`],
      ]) {
        const link = list.getByRole("link", {
          name: `Open review for ${label}`,
          exact: true,
        })
        await expect(link).toHaveAttribute("href", href)
        await expect(link).toHaveText("Open review")
        await expect(
          list.getByRole("link", {
            name: `Open listing for ${label}`,
            exact: true,
          })
        ).toHaveCount(0)
      }
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

      expect(
        (await page.context().cookies()).find(
          (cookie) => cookie.name === "np_client"
        )?.value
      ).toBe(f.clientB.id)
      for (const destination of [
        {
          label: "Approval requested",
          review: f.approval,
          queue: "approval",
          filter: "unread",
        },
        {
          label: "Reply sent back",
          review: f.sentBack,
          queue: "needs_reply",
          filter: "open",
        },
      ]) {
        if (destination.filter === "open") {
          await page.getByRole("tab", { name: "Open", exact: true }).click()
          await expect(page).toHaveURL(
            `${backend.server.baseUrl}/notifications?filter=open`
          )
          await assertUnreadRows()
        }
        const href =
          destination.queue === "approval"
            ? `/inbox?queue=approval&selected=${destination.review.reviewId}`
            : `/inbox?selected=${destination.review.reviewId}`
        await list
          .getByRole("link", {
            name: `Open review for ${destination.label}`,
            exact: true,
          })
          .click()
        await expect(page).toHaveURL(`${backend.server.baseUrl}${href}`)
        const detail = page.getByRole("region", {
          name: "Selected review",
          exact: true,
        })
        await expect(detail).toBeVisible()
        await expect(
          detail.getByText(destination.review.text, { exact: true })
        ).toBeVisible()
        // selected= must keep the notification's review accessible instead
        // of injecting the shell's remembered, different client as a filter.
        expect(new URL(page.url()).searchParams.has("clientId")).toBe(false)
        await expect(
          page.locator(
            `[data-slot="queue-tab"][data-queue="${destination.queue}"]`
          )
        ).toHaveAttribute("aria-current", "true")
        await page.goBack()
        await expect(page).toHaveURL(
          `${backend.server.baseUrl}/notifications?filter=${destination.filter}`
        )
        await assertUnreadRows()
        expect(await f.notificationState()).toEqual(before)
      }
    })
  })
