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
 * The reply textbox. The editor is always open (components/inbox/
 * reply-composer.tsx), whether the review has no reply yet, a saved draft or
 * a live reply — which also covers a retry, where the draft the first attempt
 * saved is still in the database.
 */
async function replyBox(page: Page) {
  const box = page.getByRole("textbox", { name: "Your reply" })
  await expect(box).toBeVisible()
  return box
}

/**
 * Write the reply, then press Publish once: it saves and checks the text
 * (`POST …/drafts`), then publishes the draft that save returned.
 */
async function writeAndPublish(
  page: Page,
  reviewId: string,
  body: string,
  // Under the two-person rule a publisher's press is parked for a second
  // person, so the same publish call is worded "Submit for approval" (D1).
  { submit = false }: { submit?: boolean } = {}
) {
  const box = await replyBox(page)
  await box.fill(body)
  // The pane's single status line (lib/inbox/reply-state.ts): written but not
  // yet checked is still ready, because the press runs the check.
  await expect(page.locator('[data-slot="reply-status-strip"]')).toContainText(
    submit ? "Ready to submit for approval" : "Ready to publish"
  )
  const saved = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === `/api/reviews/${reviewId}/drafts`
  )
  const published = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === `/api/reviews/${reviewId}/publish`
  )
  await page
    .getByRole("button", {
      name: submit ? /^Submit for approval/ : /^Publish reply/,
    })
    .click()
  expect((await saved).status()).toBe(201)
  const response = await published
  // The publish must carry the draft the press just saved, not an older one.
  const savedDraft = (await (await saved).json()) as { draftId: string }
  expect(response.request().postDataJSON()).toMatchObject({
    draftId: savedDraft.draftId,
  })
  return response
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

    // Location filter narrows the queue. It lives in the Filters sheet, and
    // the list behind it updates as the venue is chosen.
    await page.getByRole("button", { name: /^Filters/ }).click()
    const filters = page.getByRole("dialog", { name: "Filters" })
    await filters.getByLabel("Filter by location").click()
    await page
      .getByRole("option", {
        name: state.directReview.locationName,
        exact: true,
      })
      .click()
    await filters
      .getByRole("button", { name: /^Show \d[\d,]*\+? reviews?$/ })
      .click()
    await expect(filters).toBeHidden()
    await expect(
      list.getByText(state.approvalReview.text, { exact: true })
    ).toHaveCount(0)

    await openReview(page, state.directReview.text)
    const published = await writeAndPublish(
      page,
      state.directReview.id,
      "Thank you for your thoughtful review. We are delighted you enjoyed your stay."
    )
    expect(published.status()).toBe(200)
    // The toast, specifically, so the assertion does not depend on anything
    // else on the page reading the same words. The Google stub answers the
    // reply with no moderation state, which the server reads as PENDING, so
    // the toast says it is sent and under Google's check, not live (R01a).
    await expect(
      page.locator('[data-slot="toast-title"]', { hasText: "Reply sent" })
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
    const requested = await writeAndPublish(
      page,
      state.approval.reviewId,
      "Thank you for sharing your experience. Our team appreciates your kind feedback.",
      { submit: true }
    )
    expect(requested.status()).toBe(202)
    await expect(
      page.getByText("Submitted for approval", { exact: true })
    ).toBeVisible()
    // The person who asked cannot be the second approver: the pane says who
    // it waits on and offers no Approve or Reject (D1, server approvalScope).
    const selected = page.getByRole("region", { name: "Selected review" })
    await expect(
      selected.getByText("Waiting for another approver").first()
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Approve reply" })
    ).toHaveCount(0)

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
    // Sent, under Google's check (the stub sends no moderation state).
    await expect(
      approver.locator('[data-slot="toast-title"]', {
        hasText: "Reply sent",
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
    ).toHaveText(/(^|:)\s*Me$/)
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
    // Before inbox-08 a viewer met a disabled "Publish reply" and a read-only
    // composer. Now neither is drawn: no publish control of any kind, no
    // docked bar, no reply box to type in, and the review says in words that
    // the access is view-only (detail/reply-exception.tsx and the reply row).
    // "Not there" is stronger than "there but off": nothing to tab to, press
    // or misread as a broken button.
    const pane = page.getByRole("region", { name: "Selected review" })
    await expect(
      pane.getByText(state.approvalReview.text, { exact: true })
    ).toBeVisible()
    await expect(
      page.getByText(
        "View-only access. You can read reviews and replies; an owner or admin can reply."
      )
    ).toBeVisible()
    await expect(
      page.getByRole("button", {
        name: /^(Publish reply|Submit for approval|Update reply)$/,
      })
    ).toHaveCount(0)
    await expect(page.locator('[data-slot="composer-footer"]')).toHaveCount(0)
    // No editable reply box: none at all, or (should one return) not editable.
    const replyBoxes = page.getByRole("textbox", { name: "Your reply" })
    for (const box of await replyBoxes.all()) {
      await expect(box).not.toBeEditable()
    }
    // The UI follows the server: the viewer's own session reads the review
    // with every reply capability off (a read, nothing is sent).
    const detail = await page.request.get(
      `/api/reviews/${state.approvalReview.id}`
    )
    expect(detail.status()).toBe(200)
    const { review } = (await detail.json()) as {
      review: {
        capabilities: {
          canEdit: boolean
          canPublish: boolean
          canRequestApproval: boolean
        }
      }
    }
    expect(review.capabilities).toMatchObject({
      canEdit: false,
      canPublish: false,
      canRequestApproval: false,
    })
  })

  test("dirty draft: switching reviews confirms before discarding edits", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await useCookie(page, baseURL, state.cookie)
    await page.goto("/inbox?queue=all")
    // Dirty the review that is never replied to, so the edit is unambiguously
    // unsaved whichever order these tests run in.
    await openReview(page, state.approvalReview.text)
    await (await replyBox(page)).fill("Unsaved edit in progress")

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

/**
 * Counts how many times "Discard unsaved reply?" OPENS from here on (a
 * transition from no open dialog to one), so a second question is caught even
 * when it replaces the first between two polls.
 */
async function countDiscardPrompts(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __discardOpens: number }
    w.__discardOpens = 0
    let wasOpen = false
    const check = () => {
      const open = [...document.querySelectorAll("[role=alertdialog]")].some(
        (dialog) =>
          dialog.getAttribute("aria-label") === "Discard unsaved reply?" &&
          !dialog.hasAttribute("data-ending-style") &&
          !dialog.hasAttribute("data-closed")
      )
      if (open && !wasOpen) w.__discardOpens++
      wasOpen = open
    }
    new MutationObserver(check).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-ending-style", "data-closed", "data-open"],
    })
    check()
  })
  return () =>
    page.evaluate(
      () => (window as unknown as { __discardOpens: number }).__discardOpens
    )
}

/** The open prompt has finished arriving: no enter state, nothing animating. */
async function settled(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const sheet = document.querySelector(
          '[data-slot="alert-dialog-content"]'
        )
        if (!sheet || sheet.hasAttribute("data-starting-style")) return false
        return document
          .getAnimations()
          .every((animation) => animation.playState !== "running")
      })
    )
    .toBe(true)
}

// One question per way out (64f2c80f): a confirmed Discard leaves the review
// at once. With an unsaved reply, "Back to Inbox" (the app bar link on a
// phone) used to ask, then ask again: Discard only marked the edits for the
// unmount, so the back it re-ran still saw a dirty reply, and the leave
// guard's sentinel (a review pushed from the list) or the in-page gate (a
// deep link) put the same question up a second time.
test.describe("dirty draft: one question per way out", () => {
  const UNSAVED = "Unsaved edit, never sent"

  for (const variant of ["pushed from the list", "a deep link"] as const) {
    test(`Back to Inbox asks once, then lands on the list (390, ${variant})`, async ({
      baseURL,
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      const state = await readJourneyState()
      await useCookie(page, baseURL, state.cookie)
      if (variant === "pushed from the list") {
        await page.goto("/inbox?queue=all")
        await openReview(page, state.approvalReview.text)
      } else {
        await page.goto(`/inbox?queue=all&selected=${state.approvalReview.id}`)
      }
      await expect(page).toHaveURL(/[?&]selected=/)
      await (await replyBox(page)).fill(UNSAVED)
      const opens = await countDiscardPrompts(page)

      await page
        .getByRole("banner")
        .getByRole("link", { name: "Back to Inbox" })
        .click()
      const prompt = page.getByRole("alertdialog", {
        name: "Discard unsaved reply?",
      })
      await expect(prompt).toBeVisible()
      await settled(page)
      await prompt.getByRole("button", { name: "Discard", exact: true }).click()

      // The list, with no review selected and no prompt left or reopened.
      await expect(page).not.toHaveURL(/[?&]selected=/)
      await expect(page.locator('[data-slot="inbox"]')).toHaveAttribute(
        "data-view",
        "list"
      )
      await expect(prompt).toHaveCount(0)
      // Long enough for a second question to have opened.
      await page.waitForTimeout(1500)
      await expect(prompt).toHaveCount(0)
      expect(await opens()).toBe(1)
    })
  }

  test("Keep editing stays on the review with the reply intact (390, pushed)", async ({
    baseURL,
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const state = await readJourneyState()
    await useCookie(page, baseURL, state.cookie)
    await page.goto("/inbox?queue=all")
    await openReview(page, state.approvalReview.text)
    await (await replyBox(page)).fill(UNSAVED)
    const back = page
      .getByRole("banner")
      .getByRole("link", { name: "Back to Inbox" })
    await back.click()
    const prompt = page.getByRole("alertdialog", {
      name: "Discard unsaved reply?",
    })
    await expect(prompt).toBeVisible()
    await settled(page)
    await prompt.getByRole("button", { name: "Keep editing" }).click()
    await expect(prompt).toHaveCount(0)
    await expect(page).toHaveURL(/[?&]selected=/)
    await expect(page.getByRole("textbox", { name: "Your reply" })).toHaveValue(
      UNSAVED
    )
    // Still guarded: going back again asks again.
    await back.click()
    await expect(prompt).toBeVisible()
  })

  // On a desk the list is beside the review, so there is no Back to Inbox;
  // the way out of an unsaved reply is the shell's navigation, which asks
  // once and then goes, however the review was opened.
  for (const variant of ["pushed from the list", "a deep link"] as const) {
    test(`a shell link asks once, then leaves (1280, ${variant})`, async ({
      baseURL,
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 860 })
      const state = await readJourneyState()
      await useCookie(page, baseURL, state.cookie)
      if (variant === "pushed from the list") {
        await page.goto("/inbox?queue=all")
        await openReview(page, state.approvalReview.text)
      } else {
        await page.goto(`/inbox?queue=all&selected=${state.approvalReview.id}`)
      }
      await expect(page).toHaveURL(/[?&]selected=/)
      await expect(
        page.getByRole("link", { name: "Back to Inbox" })
      ).toHaveCount(0)
      await (await replyBox(page)).fill(UNSAVED)
      const opens = await countDiscardPrompts(page)

      await page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: "Listings" })
        .click()
      const prompt = page.getByRole("alertdialog", {
        name: "Discard unsaved reply?",
      })
      await expect(prompt).toBeVisible()
      await settled(page)
      await prompt.getByRole("button", { name: "Discard", exact: true }).click()
      await expect(page).toHaveURL(/\/listings/)
      await page.waitForTimeout(1500)
      expect(await opens()).toBe(1)
    })
  }
})
