import { expect, type Page, test } from "@playwright/test"

import { readJourneyState } from "./helpers/stub-bridge"

async function useCookie(
  page: Page,
  baseURL: string | undefined,
  cookie: string
) {
  const [name, value] = cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
}

async function openReview(page: Page, text: string) {
  await page.getByRole("button").filter({ hasText: text }).first().click()
  await expect(
    page
      .getByRole("region", { name: "Selected review" })
      .getByText(text, { exact: true })
  ).toBeVisible()
}

/**
 * Get to a reply textbox this journey can type into.
 *
 * A review that already carries saved reply text opens as a read-only preview
 * behind an "Edit reply" button (components/inbox/reply-composer.tsx); a
 * freshly seeded one, with neither a draft nor a reply, opens straight into
 * the editor. Waiting for whichever of the two is on screen covers both — and
 * covers a retry, where the draft the first attempt saved is still in the
 * database.
 */
async function openReplyEditor(page: Page) {
  const edit = page.getByRole("button", { name: "Edit reply" })
  const box = page.getByRole("textbox", { name: "Your reply" })
  await expect(edit.or(box).first()).toBeVisible()
  if (await edit.isVisible()) await edit.click()
  await expect(box).toBeVisible()
  return box
}

async function saveVerifiedDraft(page: Page, reviewId: string, body: string) {
  const box = await openReplyEditor(page)
  await box.fill(body)
  const saved = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === `/api/reviews/${reviewId}/drafts`
  )
  await page.getByRole("button", { name: "Save draft" }).click()
  expect((await saved).status()).toBe(201)
  // The pane's single status line (lib/inbox/reply-state.ts), asserted on the
  // "Ready to publish" half only: a clean check and a check carrying a note
  // read "Draft checked · …" and "Checked with a note · …" respectively, and
  // both are a green light for the publish that follows.
  await expect(page.locator('[data-slot="reply-status-strip"]')).toContainText(
    "Ready to publish"
  )
}

test.describe("inbox critical journeys", () => {
  test("publish journey: filter, open, draft, publish", async ({
    baseURL,
    page,
  }) => {
    test.setTimeout(120_000)
    const state = await readJourneyState()
    await useCookie(page, baseURL, state.cookie)

    await page.goto("/inbox?queue=all")
    const list = page.getByRole("region", { name: "Review list" })
    await expect(
      list.getByText(state.directReview.text, { exact: true })
    ).toBeVisible()
    await expect(
      list.getByText(state.approvalReview.text, { exact: true })
    ).toBeVisible()
    // The queues are five controls above the two panes now rather than a rail
    // beside them, but they are still the navigation landmark a keyboard user
    // jumps to.
    const queues = page.getByRole("navigation", { name: "Review queues" })
    await expect(
      queues.getByRole("button", { name: /^Needs reply/ })
    ).toBeVisible()

    // Location filter narrows the queue.
    await page
      .getByLabel("Filter by location")
      .fill(state.directReview.locationName)
    await page
      .getByRole("option", {
        name: state.directReview.locationName,
        exact: true,
      })
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
        new URL(r.url()).pathname ===
          `/api/reviews/${state.directReview.id}/publish`
    )
    await page.getByRole("button", { name: "Publish reply" }).click()
    expect((await published).status()).toBe(200)
    // The toast, specifically: the review's activity timeline gains a
    // "Reply published" entry at the same moment, so a page-wide text match
    // would be ambiguous.
    await expect(
      page.locator('[data-slot="toast-title"]', { hasText: "Reply published" })
    ).toBeVisible()
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
        new URL(r.url()).pathname ===
          `/api/reviews/${state.approval.reviewId}/publish`
    )
    await page.getByRole("button", { name: "Publish reply" }).click()
    expect((await requested).status()).toBe(202)
    await expect(
      page.getByText("Submitted for approval", { exact: true })
    ).toBeVisible()

    // Approver (owner) — a fresh context. Approval is one tab now: the
    // aggregate of everything parked at `awaiting_approval`, whoever it waits
    // on. "Waiting on" narrows it to what this approver may actually decide.
    const approverContext = await browser.newContext()
    const approver = await approverContext.newPage()
    await useCookie(approver, baseURL, state.approval.approverCookie)
    await approver.goto("/inbox?queue=approval")
    const approvalTab = approver
      .getByRole("navigation", { name: "Review queues" })
      .getByRole("button", { name: /^Approval/ })
    await expect(approvalTab).toHaveAttribute("aria-current", "true")
    // The assertion is the OUTCOME — "Waiting on: Me" narrows the scope to the
    // server-side `awaiting_my_approval` queue — so the interaction retries
    // rather than being asserted as a single click. The first load auto-selects
    // a review, and that URL rewrite can spring an already-open menu shut
    // (Base UI drops pointer-events during the exit, so a click on a visible
    // option falls through to the pane behind it). Re-opening and trying again
    // is what an operator does, and what this test is actually about is where
    // the choice lands.
    const owner = approver.getByRole("combobox", {
      name: "Approval waiting on",
    })
    await expect
      .poll(
        async () => {
          if (!(await approver.getByRole("listbox").isVisible())) {
            await owner.click()
          }
          await approver
            .getByRole("listbox")
            .getByRole("option", { name: "Me", exact: true })
            .click({ timeout: 2_000 })
            .catch(() => {})
          return new URL(approver.url()).searchParams.get("queue")
        },
        { timeout: 20_000 }
      )
      .toBe("awaiting_my_approval")
    await expect(approvalTab).toHaveAttribute("aria-current", "true")
    await openReview(approver, state.approval.text)
    const approved = approver.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname ===
          `/api/reviews/${state.approval.reviewId}/approval`
    )
    await approver.getByRole("button", { name: "Approve reply" }).click()
    expect((await approved).status()).toBe(200)
    await expect(
      approver.locator('[data-slot="toast-title"]', {
        hasText: "Reply published",
      })
    ).toBeVisible()
    await approverContext.close()
  })

  test("a legacy awaiting_my_approval link still lands on that scope", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await useCookie(page, baseURL, state.approval.approverCookie)
    // `queue=awaiting_my_approval` predates the Approval aggregate and is
    // still live in bookmarks, notification emails and anything an operator
    // has pasted to a colleague. Approval is a presentation union, not a new
    // record state, and ownership never became a second URL parameter — so an
    // old link keeps its own narrower server scope and simply presents as the
    // Approval tab with "Waiting on" already set to Me
    // (lib/inbox/url-state.ts).
    await page.goto("/inbox?queue=awaiting_my_approval")
    await expect(
      page.getByRole("heading", { name: "Inbox", level: 1 })
    ).toBeVisible()
    await expect(
      page
        .getByRole("navigation", { name: "Review queues" })
        .getByRole("button", { name: /^Approval/ })
    ).toHaveAttribute("aria-current", "true")
    await expect(
      page.getByRole("combobox", { name: "Approval waiting on" })
    ).toHaveText("Me")
    // Nothing rewrites the link into the aggregate: the queue the operator
    // arrived on is the queue the server is still being asked for. (Only
    // `selected` is appended, by the desktop auto-selection.)
    expect(new URL(page.url()).searchParams.get("queue")).toBe(
      "awaiting_my_approval"
    )
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
    await (await openReplyEditor(page)).fill("Unsaved edit in progress")

    // Switching away asks first. The inbox lives inside DirtyGuardProvider, so
    // the question is the in-app AlertDialog, never window.confirm.
    await page
      .getByRole("button")
      .filter({ hasText: state.directReview.text })
      .first()
      .click()
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
