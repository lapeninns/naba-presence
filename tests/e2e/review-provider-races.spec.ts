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

const queueCounts = {
  ...emptyCounts,
  total: 7,
  byStatus: { ...emptyCounts.byStatus, new: 7 },
}

const queueReview = {
  id: "00000000-0000-4000-8000-000000000111",
  location: {
    id: "00000000-0000-4000-8000-000000000222",
    name: "Queue Race Location",
  },
  reviewer: { displayName: "Queue Race Reviewer", isAnonymous: false },
  rating: 5,
  text: "Scoped data finished before the connection check.",
  detectedLanguageCode: "en",
  languageConfidence: 1,
  createTime: "2026-07-30T12:00:00.000Z",
  updateTime: "2026-07-30T12:00:00.000Z",
  workflowStatus: "new",
  verificationStatus: null,
  replyStatus: null,
  googleReplyState: null,
  googlePolicyViolation: null,
  replyBody: null,
  syncStatus: null,
  draftId: null,
  draftBody: null,
}

test("queue freshness waits for its scoped list and counts", async ({
  page,
}) => {
  let enteringQueue = false
  let reviewRequestCount = 0
  let countRequestCount = 0
  let releaseConnection = () => {}
  let releaseReviews = () => {}
  let releaseCounts = () => {}
  let markConnectionStarted = () => {}
  let markReviewsStarted = () => {}
  let markCountsStarted = () => {}
  let markReviewsFinished = () => {}
  let markCountsFinished = () => {}
  const connectionGate = new Promise<void>((resolve) => {
    releaseConnection = resolve
  })
  const reviewsGate = new Promise<void>((resolve) => {
    releaseReviews = resolve
  })
  const countsGate = new Promise<void>((resolve) => {
    releaseCounts = resolve
  })
  const connectionStarted = new Promise<void>((resolve) => {
    markConnectionStarted = resolve
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

  await page.route(/\/api\/google\/connections(?:\?.*)?$/, async (route) => {
    if (enteringQueue) {
      markConnectionStarted()
      await connectionGate
    }
    await route.fulfill({ json: { connections: [activeConnection] } })
  })
  await page.route(/\/api\/reviews\/counts(?:\?.*)?$/, async (route) => {
    countRequestCount += 1
    markCountsStarted()
    await countsGate
    await route.fulfill({ json: queueCounts })
    markCountsFinished()
  })
  await page.route(/\/api\/reviews(?:\?.*)?$/, async (route) => {
    reviewRequestCount += 1
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

    enteringQueue = true
    await page.getByRole("link", { name: "Inbox", exact: true }).click()
    await connectionStarted
    await expect(
      page.getByRole("button", { name: "Connecting", exact: true })
    ).toBeVisible()
    expect(reviewRequestCount).toBe(0)
    expect(countRequestCount).toBe(0)
    await expect(
      page.getByRole("button", { name: "Live data", exact: true })
    ).toHaveCount(0)

    releaseConnection()
    await Promise.all([reviewsStarted, countsStarted])
    releaseCounts()
    await countsFinished
    await expect(
      page.getByRole("tab", { name: "All reviews, 7", exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Connecting", exact: true })
    ).toBeVisible()

    releaseReviews()
    await reviewsFinished
    await expect(
      page.getByRole("button", { name: "Live data", exact: true })
    ).toBeVisible()
  } finally {
    releaseConnection()
    releaseReviews()
    releaseCounts()
  }
})

test("a failed queue connection check blocks data until retry revalidates it", async ({
  page,
}) => {
  let failConnectionCheck = false
  let holdRetryConnection = false
  let reviewRequestCount = 0
  let countRequestCount = 0
  let releaseRetryConnection = () => {}
  let releaseReviews = () => {}
  let releaseCounts = () => {}
  let markRetryConnectionStarted = () => {}
  let markReviewsStarted = () => {}
  let markCountsStarted = () => {}
  const retryConnectionGate = new Promise<void>((resolve) => {
    releaseRetryConnection = resolve
  })
  const reviewsGate = new Promise<void>((resolve) => {
    releaseReviews = resolve
  })
  const countsGate = new Promise<void>((resolve) => {
    releaseCounts = resolve
  })
  const retryConnectionStarted = new Promise<void>((resolve) => {
    markRetryConnectionStarted = resolve
  })
  const reviewsStarted = new Promise<void>((resolve) => {
    markReviewsStarted = resolve
  })
  const countsStarted = new Promise<void>((resolve) => {
    markCountsStarted = resolve
  })

  await page.route(/\/api\/google\/connections(?:\?.*)?$/, async (route) => {
    if (failConnectionCheck) {
      await route.abort("failed")
      return
    }
    if (holdRetryConnection) {
      markRetryConnectionStarted()
      await retryConnectionGate
    }
    await route.fulfill({ json: { connections: [activeConnection] } })
  })
  await page.route(/\/api\/reviews\/counts(?:\?.*)?$/, async (route) => {
    countRequestCount += 1
    markCountsStarted()
    await countsGate
    await route.fulfill({ json: queueCounts })
  })
  await page.route(/\/api\/reviews(?:\?.*)?$/, async (route) => {
    reviewRequestCount += 1
    markReviewsStarted()
    await reviewsGate
    await route.fulfill({ json: { items: [], nextCursor: null } })
  })

  try {
    await page.goto("/performance")
    await expect(page.getByText("Live data", { exact: true })).toBeVisible()

    failConnectionCheck = true
    await page.getByRole("link", { name: "Inbox", exact: true }).click()
    const retryButton = page.getByRole("button", {
      name: "Retry live data",
      exact: true,
    })
    await expect(retryButton).toBeVisible()
    await expect(
      page.getByText("Live review data is unavailable", { exact: true })
    ).toBeVisible()
    expect(reviewRequestCount).toBe(0)
    expect(countRequestCount).toBe(0)

    failConnectionCheck = false
    holdRetryConnection = true
    await retryButton.click()
    await retryConnectionStarted
    expect(reviewRequestCount).toBe(0)
    expect(countRequestCount).toBe(0)
    releaseRetryConnection()
    await Promise.all([reviewsStarted, countsStarted])
    releaseCounts()
    releaseReviews()

    await expect(
      page.getByRole("tab", { name: "All reviews, 7", exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Live data", exact: true })
    ).toBeVisible()
  } finally {
    releaseRetryConnection()
    releaseReviews()
    releaseCounts()
  }
})

test("a queue revalidates a disconnected connection before going live", async ({
  page,
}) => {
  let enteringQueue = false
  let reviewRequestCount = 0
  let countRequestCount = 0
  let releaseConnection = () => {}
  let markConnectionStarted = () => {}
  const connectionGate = new Promise<void>((resolve) => {
    releaseConnection = resolve
  })
  const connectionStarted = new Promise<void>((resolve) => {
    markConnectionStarted = resolve
  })

  await page.route(/\/api\/google\/connections(?:\?.*)?$/, async (route) => {
    if (!enteringQueue) {
      await route.fulfill({
        json: {
          connections: [{ ...activeConnection, status: "disconnected" }],
        },
      })
      return
    }
    markConnectionStarted()
    await connectionGate
    await route.fulfill({ json: { connections: [activeConnection] } })
  })
  await page.route(/\/api\/reviews\/counts(?:\?.*)?$/, async (route) => {
    countRequestCount += 1
    await route.fulfill({ json: queueCounts })
  })
  await page.route(/\/api\/reviews(?:\?.*)?$/, async (route) => {
    reviewRequestCount += 1
    await route.fulfill({
      json: { items: [queueReview], nextCursor: null },
    })
  })

  try {
    await page.goto("/performance")
    await expect(
      page.getByText("Google disconnected", { exact: true })
    ).toBeVisible()

    enteringQueue = true
    await page.getByRole("link", { name: "Inbox", exact: true }).click()
    await connectionStarted
    const connectingButton = page.getByRole("button", {
      name: "Connecting",
      exact: true,
    })
    await expect(connectingButton).toBeVisible()
    expect(reviewRequestCount).toBe(0)
    expect(countRequestCount).toBe(0)

    releaseConnection()
    await expect(
      page.getByRole("tab", { name: "All reviews, 7", exact: true })
    ).toBeVisible()
    await expect(
      page
        .getByRole("region", { name: "Review list" })
        .getByText(queueReview.text, { exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Live data", exact: true })
    ).toBeVisible()
  } finally {
    releaseConnection()
  }
})

test("queue-to-queue navigation validates before the next scoped requests", async ({
  page,
}) => {
  let holdConnection = false
  let reviewRequestCount = 0
  let countRequestCount = 0
  let releaseConnection = () => {}
  let markConnectionStarted = () => {}
  const connectionGate = new Promise<void>((resolve) => {
    releaseConnection = resolve
  })
  const connectionStarted = new Promise<void>((resolve) => {
    markConnectionStarted = resolve
  })

  await page.route(/\/api\/google\/connections(?:\?.*)?$/, async (route) => {
    if (holdConnection) {
      markConnectionStarted()
      await connectionGate
    }
    await route.fulfill({ json: { connections: [activeConnection] } })
  })
  await page.route(/\/api\/reviews\/counts(?:\?.*)?$/, async (route) => {
    countRequestCount += 1
    await route.fulfill({ json: emptyCounts })
  })
  await page.route(/\/api\/reviews(?:\?.*)?$/, async (route) => {
    reviewRequestCount += 1
    await route.fulfill({ json: { items: [], nextCursor: null } })
  })

  try {
    await page.goto(`/locations/${queueReview.location.id}/reviews`)
    await expect(
      page.getByRole("heading", { name: "Reviews", level: 1 })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Live data", exact: true })
    ).toBeVisible()

    reviewRequestCount = 0
    countRequestCount = 0
    holdConnection = true
    await page.getByRole("link", { name: "Inbox", exact: true }).click()
    await connectionStarted

    await expect(
      page.getByRole("button", { name: "Connecting", exact: true })
    ).toBeVisible()
    expect(reviewRequestCount).toBe(0)
    expect(countRequestCount).toBe(0)

    releaseConnection()
    await expect(
      page.getByRole("button", { name: "Live data", exact: true })
    ).toBeVisible()
    expect(reviewRequestCount).toBeGreaterThan(0)
    expect(countRequestCount).toBeGreaterThan(0)
  } finally {
    releaseConnection()
  }
})

test("a stale scoped completion cannot promote the next queue", async ({
  page,
}) => {
  let holdOldQueue = false
  let holdNewQueue = false
  let releaseOldReviews = () => {}
  let releaseOldCounts = () => {}
  let releaseNewReviews = () => {}
  let releaseNewCounts = () => {}
  let markOldReviewsStarted = () => {}
  let markOldCountsStarted = () => {}
  let markNewReviewsStarted = () => {}
  let markNewCountsStarted = () => {}
  const oldReviewsGate = new Promise<void>((resolve) => {
    releaseOldReviews = resolve
  })
  const oldCountsGate = new Promise<void>((resolve) => {
    releaseOldCounts = resolve
  })
  const newReviewsGate = new Promise<void>((resolve) => {
    releaseNewReviews = resolve
  })
  const newCountsGate = new Promise<void>((resolve) => {
    releaseNewCounts = resolve
  })
  const oldReviewsStarted = new Promise<void>((resolve) => {
    markOldReviewsStarted = resolve
  })
  const oldCountsStarted = new Promise<void>((resolve) => {
    markOldCountsStarted = resolve
  })
  const newReviewsStarted = new Promise<void>((resolve) => {
    markNewReviewsStarted = resolve
  })
  const newCountsStarted = new Promise<void>((resolve) => {
    markNewCountsStarted = resolve
  })

  await page.route(/\/api\/google\/connections(?:\?.*)?$/, async (route) => {
    await route.fulfill({ json: { connections: [activeConnection] } })
  })
  await page.route(/\/api\/reviews\/counts(?:\?.*)?$/, async (route) => {
    const locationId = new URL(route.request().url()).searchParams.get(
      "locationId"
    )
    if (locationId === queueReview.location.id && holdOldQueue) {
      markOldCountsStarted()
      await oldCountsGate
      await route.fulfill({
        json: {
          ...queueCounts,
          total: 13,
          byStatus: { ...queueCounts.byStatus, new: 13 },
        },
      })
      return
    }
    if (!locationId && holdNewQueue) {
      markNewCountsStarted()
      await newCountsGate
      await route.fulfill({ json: queueCounts })
      return
    }
    await route.fulfill({ json: emptyCounts })
  })
  await page.route(/\/api\/reviews(?:\?.*)?$/, async (route) => {
    const locationId = new URL(route.request().url()).searchParams.get(
      "location_id"
    )
    if (locationId === queueReview.location.id && holdOldQueue) {
      markOldReviewsStarted()
      await oldReviewsGate
      await route.fulfill({
        json: { items: [queueReview], nextCursor: null },
      })
      return
    }
    if (!locationId && holdNewQueue) {
      markNewReviewsStarted()
      await newReviewsGate
      await route.fulfill({ json: { items: [], nextCursor: null } })
      return
    }
    await route.fulfill({ json: { items: [], nextCursor: null } })
  })

  try {
    await page.goto(`/locations/${queueReview.location.id}/reviews`)
    await expect(
      page.getByRole("button", { name: "Live data", exact: true })
    ).toBeVisible()

    holdOldQueue = true
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"))
    })
    await Promise.all([oldReviewsStarted, oldCountsStarted])

    holdNewQueue = true
    await page.getByRole("link", { name: "Inbox", exact: true }).click()
    await releaseOldCounts()
    await releaseOldReviews()

    await expect(page).toHaveURL(/\/inbox$/)
    await Promise.all([newReviewsStarted, newCountsStarted])
    const connectingButton = page.getByRole("button", {
      name: "Connecting",
      exact: true,
    })
    await expect(connectingButton).toBeVisible()
    await expect(
      page.getByRole("tab", { name: "All reviews, 13", exact: true })
    ).toHaveCount(0)

    releaseNewCounts()
    await expect(
      page.getByRole("tab", { name: "All reviews, 7", exact: true })
    ).toBeVisible()
    await expect(connectingButton).toBeVisible()

    releaseNewReviews()
    await expect(
      page.getByRole("button", { name: "Live data", exact: true })
    ).toBeVisible()
  } finally {
    releaseOldReviews()
    releaseOldCounts()
    releaseNewReviews()
    releaseNewCounts()
  }
})

test("data-first focus recovery waits for active connection health", async ({
  page,
}) => {
  let reconnecting = false
  let releaseConnection = () => {}
  let releaseReviews = () => {}
  let releaseCounts = () => {}
  let markConnectionStarted = () => {}
  let markReviewsStarted = () => {}
  let markCountsStarted = () => {}
  const connectionGate = new Promise<void>((resolve) => {
    releaseConnection = resolve
  })
  const reviewsGate = new Promise<void>((resolve) => {
    releaseReviews = resolve
  })
  const countsGate = new Promise<void>((resolve) => {
    releaseCounts = resolve
  })
  const connectionStarted = new Promise<void>((resolve) => {
    markConnectionStarted = resolve
  })
  const reviewsStarted = new Promise<void>((resolve) => {
    markReviewsStarted = resolve
  })
  const countsStarted = new Promise<void>((resolve) => {
    markCountsStarted = resolve
  })

  await page.route(/\/api\/google\/connections(?:\?.*)?$/, async (route) => {
    if (!reconnecting) {
      await route.fulfill({
        json: {
          connections: [{ ...activeConnection, status: "disconnected" }],
        },
      })
      return
    }
    markConnectionStarted()
    await connectionGate
    await route.fulfill({ json: { connections: [activeConnection] } })
  })
  await page.route(/\/api\/reviews\/counts(?:\?.*)?$/, async (route) => {
    if (!reconnecting) {
      await route.abort("failed")
      return
    }
    markCountsStarted()
    await countsGate
    await route.fulfill({ json: queueCounts })
  })
  await page.route(/\/api\/reviews(?:\?.*)?$/, async (route) => {
    if (!reconnecting) {
      await route.abort("failed")
      return
    }
    markReviewsStarted()
    await reviewsGate
    await route.fulfill({
      json: { items: [queueReview], nextCursor: null },
    })
  })

  try {
    await page.goto("/inbox")
    const disconnectedButton = page.getByRole("button", {
      name: "Google disconnected",
      exact: true,
    })
    await expect(disconnectedButton).toBeVisible()

    reconnecting = true
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"))
    })
    await Promise.all([connectionStarted, reviewsStarted, countsStarted])

    releaseCounts()
    releaseReviews()
    await expect(
      page.getByRole("tab", { name: "All reviews, 7", exact: true })
    ).toBeVisible()
    await expect(
      page
        .getByRole("region", { name: "Review list" })
        .getByText(queueReview.text, { exact: true })
    ).toBeVisible()
    await expect(disconnectedButton).toBeVisible()

    releaseConnection()
    await expect(
      page.getByRole("button", { name: "Live data", exact: true })
    ).toBeVisible()
  } finally {
    releaseConnection()
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

  await page.route(/\/api\/google\/connections(?:\?.*)?$/, async (route) => {
    connectionRequestCount += 1
    const isBootstrap = connectionRequestCount === 1
    if (isBootstrap) {
      markBootstrapStarted()
      await bootstrapGate
    }
    await route.fulfill({ json: { connections: [activeConnection] } })
    if (isBootstrap) markBootstrapFinished()
  })
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
