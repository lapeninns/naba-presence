import { expect, type Page, test } from "@playwright/test"

import { readJourneyState } from "./helpers/stub-bridge"

async function useCookie(page: Page, baseURL: string | undefined, cookie: string) {
  const [name, value] = cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
}

async function openReview(page: Page, text: string) {
  await page.getByRole("button").filter({ hasText: text }).first().click()
  await expect(
    page.getByRole("region", { name: "Selected review" }).getByText(text, { exact: true })
  ).toBeVisible()
}

async function saveVerifiedDraft(page: Page, reviewId: string, body: string) {
  await page.getByRole("textbox", { name: "Reply draft" }).fill(body)
  const saved = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === `/api/reviews/${reviewId}/drafts`
  )
  await page.getByRole("button", { name: "Save draft" }).click()
  expect((await saved).status()).toBe(201)
  await expect(page.getByText("Passed", { exact: true })).toBeVisible()
}

test.describe("inbox critical journeys", () => {
  test("publish journey: filter, open, draft, publish", async ({ baseURL, page }) => {
    test.setTimeout(120_000)
    const state = await readJourneyState()
    await useCookie(page, baseURL, state.cookie)

    await page.goto("/inbox")
    const list = page.getByRole("region", { name: "Review list" })
    await expect(list.getByText(state.directReview.text, { exact: true })).toBeVisible()
    await expect(list.getByText(state.approvalReview.text, { exact: true })).toBeVisible()
    await expect(page.getByRole("tab", { name: /All reviews,\s+2/ })).toBeVisible()

    // Location filter narrows the queue and scopes counts.
    await page.getByLabel("Filter by location").fill(state.directReview.locationName)
    await page
      .getByRole("option", { name: state.directReview.locationName, exact: true })
      .click()
    await expect(page.getByRole("tab", { name: /All reviews,\s+1/ })).toBeVisible()

    await openReview(page, state.directReview.text)
    await saveVerifiedDraft(
      page,
      state.directReview.id,
      "Thank you for your thoughtful review. We are delighted you enjoyed your stay."
    )
    const published = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname === `/api/reviews/${state.directReview.id}/publish`
    )
    await page.getByRole("button", { name: "Publish reply" }).click()
    expect((await published).status()).toBe(200)
    await expect(page.getByText("Reply published", { exact: true })).toBeVisible()
  })

  test("approver journey: request routes to approval, approver publishes", async ({
    baseURL,
    browser,
    page,
  }) => {
    test.setTimeout(120_000)
    const state = await readJourneyState()

    // Requester -- a distinct, two-person-approval organisation whose first
    // publish attempt (even by an authorised publisher) routes to approval.
    await useCookie(page, baseURL, state.approval.requesterCookie)
    await page.goto("/inbox")
    await openReview(page, state.approval.text)
    await saveVerifiedDraft(
      page,
      state.approval.reviewId,
      "Thank you for sharing your experience. Our team appreciates your kind feedback."
    )
    const requested = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname === `/api/reviews/${state.approval.reviewId}/publish`
    )
    await page.getByRole("button", { name: "Publish reply" }).click()
    expect((await requested).status()).toBe(202)
    await expect(
      page.getByText("Reply submitted for approval.", { exact: true })
    ).toBeVisible()

    // Approver (owner) — a fresh context; the awaiting-approval tab shows it.
    const approverContext = await browser.newContext()
    const approver = await approverContext.newPage()
    await useCookie(approver, baseURL, state.approval.approverCookie)
    await approver.goto("/inbox?queue=awaiting_approval")
    await openReview(approver, state.approval.text)
    const approved = approver.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname === `/api/reviews/${state.approval.reviewId}/approval`
    )
    await approver.getByRole("button", { name: "Approve reply" }).click()
    expect((await approved).status()).toBe(200)
    await expect(approver.getByText("Reply published", { exact: true })).toBeVisible()
    await approverContext.close()
  })

  test("permission walk: a viewer cannot reach a publish control", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await useCookie(page, baseURL, state.viewerCookie)
    await page.goto("/inbox")
    await openReview(page, state.directReview.text)
    const publish = page.getByRole("button", { name: "Publish reply" })
    await expect(publish).toBeDisabled()
    await expect(page.getByRole("textbox", { name: "Reply draft" })).toBeDisabled()
  })

  test("dirty draft: switching reviews confirms before discarding edits", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await useCookie(page, baseURL, state.cookie)
    await page.goto("/inbox")
    await openReview(page, state.directReview.text)
    await page.getByRole("textbox", { name: "Reply draft" }).fill("Unsaved edit in progress")

    // Cancelling the confirm keeps us on the same review with the text intact.
    page.once("dialog", (dialog) => dialog.dismiss())
    await page.getByRole("button").filter({ hasText: state.approvalReview.text }).first().click()
    await expect(page.getByRole("textbox", { name: "Reply draft" })).toHaveValue(
      "Unsaved edit in progress"
    )
  })
})
