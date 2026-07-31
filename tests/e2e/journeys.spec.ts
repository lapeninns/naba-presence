import { expect, type Page, type Request, test } from "@playwright/test"

import {
  readJourneyState,
  type JourneyState,
} from "./helpers/stub-bridge"

test.describe("critical browser journeys", () => {
  test("real HTTP, route and database workflows remain coherent", async ({
    baseURL,
    context,
    page,
  }) => {
    test.setTimeout(120_000)
    const state = await readJourneyState()
    const [name, value] = state.cookie.split("=", 2)
    await context.addCookies([{ name, value, url: baseURL! }])

    await page.goto("/inbox")
    const reviewList = page.getByRole("region", { name: "Review list" })
    await expect(
      reviewList.getByText(state.directReview.text, { exact: true })
    ).toBeVisible()
    await expect(
      reviewList.getByText(state.approvalReview.text, { exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole("tab", { name: /All reviews,\s+2/ })
    ).toBeVisible()

    await verifyLocationScopedQueue(page, state)
    await page.goto("/inbox")
    await verifyServerFilters(page, state)
    await page.reload()

    await openReview(page, state.directReview.text)
    const directBody =
      "Thank you for your thoughtful review. We are delighted you enjoyed your stay."
    await saveVerifiedDraft(page, state.directReview.id, directBody)
    const directPublish = page.waitForResponse(
      isApiMutation(`/api/reviews/${state.directReview.id}/publish`, "POST")
    )
    await page.getByRole("button", { name: "Publish reply" }).click()
    expect((await directPublish).status()).toBe(200)
    await expect(
      page.getByRole("alert").filter({ hasText: "Reply published" })
    ).toBeVisible()
    await expect(page.getByText("Published", { exact: true }).first()).toBeVisible()

    await page.getByRole("link", { name: "Home", exact: true }).click()
    await expectNeedsAttention(page, "1")

    const analyticsResponse = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return (
        response.request().method() === "GET" &&
        url.pathname === "/api/analytics/overview"
      )
    })
    await page.goto("/performance")
    await expect(
      page.getByRole("heading", { name: "Performance", level: 1 })
    ).toBeVisible()
    const analytics = (await (await analyticsResponse).json()) as {
      timezone: string
    }
    expect(analytics.timezone).toBe(state.timezone)
    await expect(
      page.getByText("Review and reply volume", { exact: true })
    ).toBeVisible()

    await page.goto("/settings")
    const approvalSwitch = page.getByRole("switch", {
      name: "Require human approval",
    })
    await expect(approvalSwitch).not.toBeChecked()
    await approvalSwitch.click()
    const twoPersonSwitch = page.getByRole("switch", {
      name: "Require two-person approval",
    })
    await expect(twoPersonSwitch).toBeVisible()
    await twoPersonSwitch.click()
    const policySave = page.waitForResponse(
      isApiMutation("/api/settings", "PATCH")
    )
    await page.getByRole("button", { name: "Save policy" }).click()
    expect((await policySave).status()).toBe(200)
    await expect(approvalSwitch).toBeChecked()
    await expect(twoPersonSwitch).toBeChecked()

    const timezoneInput = page.getByLabel("IANA timezone")
    await timezoneInput.fill("America/New_York")
    const localeSave = page.waitForResponse(
      isApiMutation("/api/settings", "PATCH")
    )
    await page.getByRole("button", { name: "Save locale" }).click()
    expect((await localeSave).status()).toBe(200)
    await page.reload()
    await expect(page.getByLabel("IANA timezone")).toHaveValue(
      "America/New_York"
    )
    await expect(
      page.getByRole("switch", { name: "Require two-person approval" })
    ).toBeChecked()

    await page.goto("/inbox")
    await openReview(page, state.approvalReview.text)
    const approvalBody =
      "Thank you for sharing your experience. Our team appreciates your kind feedback."
    await saveVerifiedDraft(page, state.approvalReview.id, approvalBody)
    const approvalPublish = page.waitForResponse(
      isApiMutation(`/api/reviews/${state.approvalReview.id}/publish`, "POST")
    )
    await page.getByRole("button", { name: "Publish reply" }).click()
    expect((await approvalPublish).status()).toBe(202)
    await expect(
      page.getByText("Awaiting approval", { exact: true }).first()
    ).toBeVisible()
    await expect(
      page.getByText("Reply submitted for approval.", { exact: true })
    ).toBeVisible()

    await page.goto("/inbox")
    await page.getByRole("tab", { name: /Published/ }).click()
    await openReview(page, state.directReview.text)
    await page.getByRole("button", { name: "Review actions" }).click()
    await page
      .getByRole("menuitem", { name: "Delete published reply" })
      .click()
    const replyDelete = page.waitForResponse(
      isApiMutation(`/api/reviews/${state.directReview.id}/reply`, "DELETE")
    )
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete reply" })
      .click()
    expect((await replyDelete).status()).toBe(200)
    await expect(
      page.getByText("Published reply deleted", { exact: true })
    ).toBeVisible()
    const deletedDetail = await page.evaluate(async (reviewId) => {
      const response = await fetch(`/api/reviews/${reviewId}`)
      if (!response.ok) throw new Error(`Review detail failed: ${response.status}`)
      return response.json() as Promise<{
        review: { workflowStatus: string }
      }>
    }, state.directReview.id)
    expect(deletedDetail.review.workflowStatus).toBe("new")

    await page.goto("/settings/connections")
    await expect(
      page.getByText("stub@example.test", { exact: true })
    ).toBeVisible()
    const linkedLocation = page
      .getByRole("listitem")
      .filter({ hasText: state.directReview.locationName })
      .filter({ has: page.getByRole("button", { name: "Unlink" }) })
    await expect(linkedLocation).toHaveCount(1)
    await linkedLocation.getByRole("button", { name: "Unlink" }).click()
    const unlinkResponse = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return (
        response.request().method() === "DELETE" &&
        url.pathname === "/api/location-links" &&
        url.searchParams.get("externalLocationId") ===
          state.externalLocationId
      )
    })
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Unlink", exact: true })
      .click()
    expect((await unlinkResponse).status()).toBe(200)
    await expect(
      page.getByText(`${state.directReview.locationName} was unlinked.`, {
        exact: true,
      })
    ).toBeVisible()
  })
})

async function verifyLocationScopedQueue(page: Page, state: JourneyState) {
  const isScopedReviewsResponse = (response: {
    request(): { method(): string }
    url(): string
  }) => {
    const url = new URL(response.url())
    return (
      response.request().method() === "GET" &&
      url.pathname === "/api/reviews" &&
      url.searchParams.get("location_id") === state.directReview.locationId
    )
  }
  const unscopedQueueRequests: string[] = []
  const recordUnscopedQueueRequest = (request: Request) => {
    const url = new URL(request.url())
    if (request.method() !== "GET") return
    const isUnscopedReviews =
      url.pathname === "/api/reviews" &&
      !url.searchParams.has("location_id")
    const isUnscopedCounts =
      url.pathname === "/api/reviews/counts" &&
      !url.searchParams.has("locationId")
    if (isUnscopedReviews || isUnscopedCounts) {
      unscopedQueueRequests.push(url.toString())
    }
  }
  page.on("request", recordUnscopedQueueRequest)

  const scopedReviews = page.waitForResponse(isScopedReviewsResponse)
  const scopedCounts = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      response.request().method() === "GET" &&
      url.pathname === "/api/reviews/counts" &&
      url.searchParams.get("locationId") === state.directReview.locationId
    )
  })

  await page.goto(
    `/locations/${state.directReview.locationId}/reviews`
  )
  expect((await scopedReviews).status()).toBe(200)
  expect((await scopedCounts).status()).toBe(200)
  await expect(
    page.getByRole("heading", { name: "Reviews", level: 1 })
  ).toBeVisible()
  await expect(page.getByLabel("Filter by location")).toHaveCount(0)

  const reviewList = page.getByRole("region", { name: "Review list" })
  await expect(
    reviewList.getByText(state.directReview.text, { exact: true })
  ).toBeVisible()
  await expect(
    reviewList.getByText(state.approvalReview.text, { exact: true })
  ).toHaveCount(0)
  await expect(
    page.getByRole("tab", { name: /All reviews,\s+1/ })
  ).toBeVisible()

  const backgroundReviews = page.waitForResponse(isScopedReviewsResponse)
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  expect((await backgroundReviews).status()).toBe(200)
  await expect(
    reviewList.getByText(state.approvalReview.text, { exact: true })
  ).toHaveCount(0)

  const refreshedReviews = page.waitForResponse(isScopedReviewsResponse)
  await page.getByRole("button", { name: "Live data" }).click()
  expect((await refreshedReviews).status()).toBe(200)
  await expect(
    reviewList.getByText(state.approvalReview.text, { exact: true })
  ).toHaveCount(0)
  page.off("request", recordUnscopedQueueRequest)
  expect(unscopedQueueRequests).toEqual([])

  await page.getByRole("link", { name: "Home", exact: true }).click()
  await expectNeedsAttention(page, "2")
}

async function verifyServerFilters(page: Page, state: JourneyState) {
  const locationReviews = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      response.request().method() === "GET" &&
      url.pathname === "/api/reviews" &&
      url.searchParams.get("location_id") === state.directReview.locationId
    )
  })
  const locationCounts = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      response.request().method() === "GET" &&
      url.pathname === "/api/reviews/counts" &&
      url.searchParams.get("locationId") === state.directReview.locationId
    )
  })
  const locationFilter = page.getByLabel("Filter by location")
  await locationFilter.fill(state.directReview.locationName)
  await page
    .getByRole("option", {
      name: state.directReview.locationName,
      exact: true,
    })
    .click()
  expect((await locationReviews).status()).toBe(200)
  const counts = (await (await locationCounts).json()) as { total: number }
  expect(counts.total).toBe(1)
  await expect(
    page.getByRole("tab", { name: /All reviews,\s+1/ })
  ).toBeVisible()

  const queueResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    const statuses = url.searchParams.get("status")?.split(",") ?? []
    return (
      response.request().method() === "GET" &&
      url.pathname === "/api/reviews" &&
      url.searchParams.get("location_id") === state.directReview.locationId &&
      statuses.includes("new")
    )
  })
  await page.getByRole("tab", { name: /Needs reply/ }).click()
  expect((await queueResponse).status()).toBe(200)
  await expect(
    page
      .getByRole("region", { name: "Review list" })
      .getByText(state.directReview.text, { exact: true })
  ).toBeVisible()
  await expect(
    page
      .getByRole("region", { name: "Review list" })
      .getByText(state.approvalReview.text, { exact: true })
  ).toHaveCount(0)

  await page.getByRole("link", { name: "Home", exact: true }).click()
  await expectNeedsAttention(page, "2")

  await page.goto("/inbox")
  await expect(
    page.getByRole("heading", { name: "Inbox", level: 1 })
  ).toBeVisible()
}

async function expectNeedsAttention(page: Page, value: string) {
  await expect(
    page.getByRole("heading", { name: "Home", level: 1 })
  ).toBeVisible()
  const attentionCard = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Needs attention" })
  await expect(attentionCard.locator('[data-slot="card-content"] > p').first())
    .toHaveText(value)
}

async function openReview(page: Page, reviewText: string) {
  await page
    .getByRole("button")
    .filter({ hasText: reviewText })
    .click()
  await expect(
    page
      .getByRole("region", { name: "Selected review" })
      .getByText(reviewText, { exact: true })
  ).toBeVisible()
}

async function saveVerifiedDraft(
  page: Page,
  reviewId: string,
  body: string
) {
  await page.getByRole("textbox", { name: "Reply draft" }).fill(body)
  const saveResponse = page.waitForResponse(
    isApiMutation(`/api/reviews/${reviewId}/drafts`, "POST")
  )
  await page.getByRole("button", { name: "Save draft" }).click()
  const response = await saveResponse
  expect(response.status()).toBe(201)
  const draft = (await response.json()) as {
    verification: { verdict: string }
  }
  expect(draft.verification.verdict).toBe("pass")
  await expect(page.getByText("Passed", { exact: true })).toBeVisible()
}

function isApiMutation(pathname: string, method: string) {
  return (response: { url(): string; request(): { method(): string } }) =>
    response.request().method() === method &&
    new URL(response.url()).pathname === pathname
}
