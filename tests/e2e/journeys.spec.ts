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
  await page.getByRole("textbox", { name: "Your reply" }).fill(body)
  const saved = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === `/api/reviews/${reviewId}/drafts`
  )
  await page.getByRole("button", { name: "Save draft" }).click()
  expect((await saved).status()).toBe(201)
  await expect(page.getByText("Ready to publish", { exact: true })).toBeVisible()
}

test.describe("inbox critical journeys", () => {
  test("publish journey: filter, open, draft, publish", async ({ baseURL, page }) => {
    test.setTimeout(120_000)
    const state = await readJourneyState()
    await useCookie(page, baseURL, state.cookie)

    await page.goto("/inbox?queue=all")
    const list = page.getByRole("region", { name: "Review list" })
    await expect(list.getByText(state.directReview.text, { exact: true })).toBeVisible()
    await expect(list.getByText(state.approvalReview.text, { exact: true })).toBeVisible()
    // The queue tab strip became a rail grouped by client: an agency's first
    // question is which client is behind, not which workflow state a review
    // is in.
    const rail = page.getByRole("navigation", { name: "Review queues" })
    await expect(rail.getByRole("button", { name: /^Needs reply/ })).toBeVisible()

    // Location filter narrows the queue.
    await page.getByLabel("Filter by location").fill(state.directReview.locationName)
    await page
      .getByRole("option", { name: state.directReview.locationName, exact: true })
      .click()
    await expect(
      list.getByText(state.approvalReview.text, { exact: true })
    ).toHaveCount(0)

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
      page.getByText("Submitted for approval", { exact: true })
    ).toBeVisible()

    // Approver (owner) — a fresh context; the awaiting-approval tab shows it.
    const approverContext = await browser.newContext()
    const approver = await approverContext.newPage()
    await useCookie(approver, baseURL, state.approval.approverCookie)
    await approver.goto("/inbox?queue=awaiting_my_approval")
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
    // The approval review, not the direct one: the publish journey above
    // leaves `directReview` live on Google, which drops it out of the default
    // Needs reply queue AND relabels the action bar's primary control "Update
    // reply" (components/inbox/action-bar.tsx). `approvalReview` is never
    // replied to, so the viewer meets the control in its "Publish reply"
    // state whichever order these tests run in.
    await openReview(page, state.approvalReview.text)
    const publish = page.getByRole("button", { name: "Publish reply" })
    await expect(publish).toBeDisabled()
    // The composer is READ-ONLY, not disabled: a viewer is meant to be able to
    // read and copy the reply (reply-composer.tsx sets `readOnly`, keeping the
    // text selectable) and is told why in words. `not.toBeEditable()` is what
    // actually holds a viewer out of the box — `toBeDisabled()` is false for a
    // readonly control, so it was asserting nothing about this composer.
    await expect(
      page.getByRole("textbox", { name: "Your reply" })
    ).not.toBeEditable()
    await expect(
      page.getByText(
        "You can read this reply, but you do not have permission to edit it."
      )
    ).toBeVisible()
  })

  test("dirty draft: switching reviews confirms before discarding edits", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await useCookie(page, baseURL, state.cookie)
    await page.goto("/inbox?queue=all")
    // Dirty the review that is never replied to: the publish journey above
    // leaves `directReview` in sync with Google, and a settled reply renders
    // as a read-only summary behind an "Edit reply" button
    // (components/inbox/reply-composer.tsx) — no textbox to dirty.
    await openReview(page, state.approvalReview.text)
    await page.getByRole("textbox", { name: "Your reply" }).fill("Unsaved edit in progress")

    // Switching away asks first. The inbox lives inside DirtyGuardProvider, so
    // the question is the in-app AlertDialog, never window.confirm.
    await page.getByRole("button").filter({ hasText: state.directReview.text }).first().click()
    const discard = page.getByRole("alertdialog", {
      name: "Discard unsaved reply?",
    })
    await expect(discard).toBeVisible()

    // Keeping the edits stays on the same review with the text intact.
    await discard.getByRole("button", { name: "Keep editing" }).click()
    await expect(
      page
        .getByRole("region", { name: "Selected review" })
        .getByText(state.approvalReview.text, { exact: true })
    ).toBeVisible()
    await expect(page.getByRole("textbox", { name: "Your reply" })).toHaveValue(
      "Unsaved edit in progress"
    )
  })
})
