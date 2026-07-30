import { expect, test } from "@playwright/test"

const activeConnection = {
  id: "connection-provider-race",
  googleEmail: "race@example.test",
  status: "active",
  notificationsEnabled: true,
  lastRefreshAt: null,
  lastErrorCode: null,
  reconnectRequired: false,
  createdAt: "2026-07-30T12:00:00.000Z",
}

const emptyCounts = {
  total: 0,
  byStatus: {
    new: 0,
    drafted: 0,
    verified: 0,
    awaiting_approval: 0,
    publish_requested: 0,
    published: 0,
    rejected: 0,
    failed: 0,
    escalated: 0,
  },
}

test("queue freshness waits for its scoped list and counts", async ({
  page,
}) => {
  let releaseReviews = () => {}
  let releaseCounts = () => {}
  let markReviewsStarted = () => {}
  let markCountsStarted = () => {}
  let markReviewsFinished = () => {}
  let markCountsFinished = () => {}
  const reviewsGate = new Promise<void>((resolve) => {
    releaseReviews = resolve
  })
  const countsGate = new Promise<void>((resolve) => {
    releaseCounts = resolve
  })
  const reviewsStarted = new Promise<void>((resolve) => {
    markReviewsStarted = resolve
  })
  const countsStarted = new Promise<void>((resolve) => {
    markCountsStarted = resolve
  })
  const reviewsFinished = new Promise<void>((resolve) => {
    markReviewsFinished = resolve
  })
  const countsFinished = new Promise<void>((resolve) => {
    markCountsFinished = resolve
  })

  await page.route(
    /\/api\/google\/connections(?:\?.*)?$/,
    async (route) => {
      await route.fulfill({ json: { connections: [activeConnection] } })
    }
  )
  await page.route(/\/api\/reviews\/counts(?:\?.*)?$/, async (route) => {
    markCountsStarted()
    await countsGate
    await route.fulfill({ json: emptyCounts })
    markCountsFinished()
  })
  await page.route(/\/api\/reviews(?:\?.*)?$/, async (route) => {
    markReviewsStarted()
    await reviewsGate
    await route.fulfill({ json: { items: [], nextCursor: null } })
    markReviewsFinished()
  })

  try {
    await page.goto("/performance")
    await expect(
      page.getByRole("heading", { name: "Performance", level: 1 })
    ).toBeVisible()
    await expect(page.getByText("Live data", { exact: true })).toBeVisible()

    await page.getByRole("link", { name: "Inbox", exact: true }).click()
    await Promise.all([reviewsStarted, countsStarted])

    await expect(
      page.getByRole("button", { name: "Connecting", exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Live data", exact: true })
    ).toHaveCount(0)

    releaseReviews()
    await reviewsFinished
    await expect(
      page.getByRole("button", { name: "Connecting", exact: true })
    ).toBeVisible()

    releaseCounts()
    await countsFinished
    await expect(
      page.getByRole("button", { name: "Live data", exact: true })
    ).toBeVisible()
  } finally {
    releaseReviews()
    releaseCounts()
  }
})

test("a stale bootstrap cannot hide a newer Home data failure", async ({
  page,
}) => {
  let connectionRequestCount = 0
  let releaseBootstrap = () => {}
  let markBootstrapStarted = () => {}
  let markBootstrapFinished = () => {}
  const bootstrapGate = new Promise<void>((resolve) => {
    releaseBootstrap = resolve
  })
  const bootstrapStarted = new Promise<void>((resolve) => {
    markBootstrapStarted = resolve
  })
  const bootstrapFinished = new Promise<void>((resolve) => {
    markBootstrapFinished = resolve
  })

  await page.route(
    /\/api\/google\/connections(?:\?.*)?$/,
    async (route) => {
      connectionRequestCount += 1
      const isBootstrap = connectionRequestCount === 1
      if (isBootstrap) {
        markBootstrapStarted()
        await bootstrapGate
      }
      await route.fulfill({ json: { connections: [activeConnection] } })
      if (isBootstrap) markBootstrapFinished()
    }
  )
  await page.route(/\/api\/reviews\/counts(?:\?.*)?$/, async (route) => {
    await route.fulfill({ json: emptyCounts })
  })
  await page.route(/\/api\/reviews(?:\?.*)?$/, async (route) => {
    await route.abort("failed")
  })

  try {
    await page.goto("/inbox")
    await bootstrapStarted
    await page.getByRole("link", { name: "Home", exact: true }).click()
    await expect(
      page.getByRole("heading", { name: "Home", level: 1 })
    ).toBeVisible()
    await expect(page.getByText("Live data unavailable")).toBeVisible()

    releaseBootstrap()
    await bootstrapFinished
    await page.waitForTimeout(250)

    await expect(page.getByText("Live data unavailable")).toBeVisible()
    await expect(page.getByText("Live data", { exact: true })).toHaveCount(0)
  } finally {
    releaseBootstrap()
  }
})
