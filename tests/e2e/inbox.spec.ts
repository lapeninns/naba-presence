import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, test } from "@playwright/test"

import { readJourneyState } from "./helpers/stub-bridge"

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
const STRUCTURE_RULES = [
  "landmark-no-duplicate-main",
  "landmark-main-is-top-level",
  "heading-order",
  "page-has-heading-one",
]

// A 1x1 transparent PNG, served locally by the route interception below so
// the R1 remote-thumbnail test never makes a real network call.
const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
)

async function applyCookie(
  page: Page,
  baseURL: string | undefined,
  cookie: string
) {
  const [name, value] = cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
}

test.describe("inbox", () => {
  test("renders the review queue", async ({ page }) => {
    await page.goto("/inbox")
    expect(new URL(page.url()).pathname).toBe("/inbox")
    await expect(
      page.getByRole("heading", { name: "Inbox", level: 1 })
    ).toBeVisible()
    await expect(
      page.getByRole("searchbox", { name: "Search reviews" })
    ).toBeVisible()
    // The permanent left rail is gone: five queue controls and a compact
    // filter toolbar sit above the list and the detail. Located by slot rather
    // than by name, because a control's accessible name can also carry its
    // count ("Approval, 5 reviews").
    await expect(
      page.getByRole("navigation", { name: "Review queues" })
    ).toBeVisible()
    await expect(page.locator('[data-slot="queue-tab"]')).toHaveCount(5)
    for (const queue of [
      "needs_reply",
      "approval",
      "publishing",
      "failed",
      "done",
    ]) {
      await expect(
        page.locator(`[data-slot="queue-tab"][data-queue="${queue}"]`)
      ).toBeVisible()
    }
    // Approval is one control standing in for both `awaiting_approval`
    // queues, so neither of the old per-owner tabs is drawn — the ownership
    // question is asked by the "Waiting on" filter instead, and only inside
    // Approval. This is the default Needs reply queue, so it is absent here.
    await expect(
      page.locator('[data-slot="queue-tab"][data-queue="awaiting_my_approval"]')
    ).toHaveCount(0)
    await expect(
      page.locator('[data-slot="queue-tab"][data-queue="needs_reply"]')
    ).toHaveAttribute("aria-current", "true")
    await expect(
      page.getByRole("group", { name: "Filter reviews" })
    ).toBeVisible()
    await expect(
      page.getByRole("combobox", { name: "Approval waiting on" })
    ).toBeHidden()
  })

  // R07: rating and "With text" are one-tap chips above the list, not groups
  // inside the Filters sheet. 5 stars with text was Filters, 5 stars, With
  // text, "Show 1 review" (four taps); it is now two.
  test("filters by 5 stars with text in two taps, from chips above the list", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto("/inbox")
    const quick = page.getByRole("group", { name: "Quick filters" })
    await expect(quick).toBeVisible()
    const stars = quick.getByRole("button", { name: "5 stars" })
    const withText = quick.getByRole("button", { name: "With text" })
    await expect(stars).toHaveAttribute("aria-pressed", "false")

    await stars.click()
    await expect(stars).toHaveAttribute("aria-pressed", "true")
    await withText.click()
    await expect(withText).toHaveAttribute("aria-pressed", "true")
    await expect
      .poll(() => {
        const params = new URL(page.url()).searchParams
        return [params.get("rating"), params.get("written")]
      })
      .toEqual(["5", "with_text"])

    // Tapping a pressed chip again takes that filter off in one tap.
    await stars.click()
    await expect(stars).toHaveAttribute("aria-pressed", "false")
    await expect
      .poll(() => new URL(page.url()).searchParams.get("rating"))
      .toBeNull()
  })

  test("keeps rating, client and reply status out of the Filters sheet", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto("/inbox")
    await page.getByRole("button", { name: /^Filters/ }).click()
    const sheet = page.getByRole("dialog", { name: "Filters" })
    await expect(sheet).toBeVisible()
    await expect(
      sheet.getByRole("combobox", { name: "Filter by location" })
    ).toBeVisible()
    await expect(sheet.getByRole("group", { name: "Rating" })).toHaveCount(0)
    await expect(
      sheet.getByRole("combobox", { name: "Filter by client" })
    ).toHaveCount(0)
    await expect(
      sheet.getByRole("radiogroup", { name: "Reply status" })
    ).toHaveCount(0)
  })

  // R3 F2-S2 / RC3 QA #2: on a phone the venue line keeps the client ·
  // location readable. Beside the stars, a status pill used to squeeze it to
  // an ellipsis, and at 390 the line truncated even without one ("Stub
  // locat…"). The pill now drops under the venue below sm (24rem). R09
  // (DSK-12): the venue is one line, so a long "client · listing" no longer
  // wraps a row to three lines; the client truncates before the listing, and
  // the whole text is the title.
  for (const width of [320, 360, 390]) {
    test(`keeps the venue readable on a ${width}px phone`, async ({
      baseURL,
      page,
    }) => {
      // The seeded tenant, in the queue that shows every status pill (no
      // tab to repeat it), so the pill-beside-venue case is really drawn.
      const state = await readJourneyState()
      await applyCookie(page, baseURL, state.cookie)
      await page.setViewportSize({ width, height: 700 })
      await page.goto("/inbox?queue=all")
      const rows = page.locator('[data-slot="review-row-venue"]')
      await expect(rows.first()).toBeVisible()
      const count = await rows.count()
      for (let index = 0; index < count; index += 1) {
        const venue = rows.nth(index)
        const location = venue.locator('[data-slot="review-row-location"]')
        const box = await location.boundingBox()
        const line = await venue.boundingBox()
        // The venue has the line beside the stars to itself: well over half
        // of it, and never a sliver.
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(96)
        expect(box!.width).toBeGreaterThan(line!.width * 0.55)
        // One line: the venue is never taller than a line and a half, and
        // its full text stays available as the title.
        const lineHeight = await location.evaluate(
          (node) =>
            parseFloat(getComputedStyle(node).lineHeight) ||
            parseFloat(getComputedStyle(node).fontSize) * 1.5
        )
        expect(box!.height).toBeLessThanOrEqual(lineHeight * 1.5)
        await expect(location).toHaveAttribute("title", /\S/)
        const status = venue.locator('[data-slot="review-row-status"]')
        if ((await status.count()) > 0) {
          const pill = await status.boundingBox()
          // On its own line, under the venue, at phone widths.
          expect(pill!.y).toBeGreaterThanOrEqual(box!.y + box!.height - 1)
        }
      }
    })
  }

  // RC3 QA #1: on a phone in select mode a tap on a row's tick box landed
  // on the row's control wrapper (its 44px overhang was drawn over the box),
  // so Playwright's tap, like the agentic run's, found the box covered and
  // nothing was ticked. A tap must reach the box itself and tick it.
  test.describe("on a touch phone", () => {
    test.use({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    })

    test("a tap on a row's tick box ticks it in select mode", async ({
      baseURL,
      page,
    }) => {
      const state = await readJourneyState()
      await applyCookie(page, baseURL, state.cookie)
      await page.goto("/inbox")
      await page.getByRole("button", { name: "Select", exact: true }).tap()
      const boxes = page.getByRole("checkbox", {
        name: /^Select the review from /,
      })
      await expect(boxes.first()).toBeVisible()
      await boxes.first().tap()
      await expect(boxes.first()).toHaveAttribute("aria-checked", "true")
      // Ticking does not open the review.
      expect(new URL(page.url()).searchParams.get("selected")).toBeNull()
      // R09 (INB-17): the list header says how many once, beside the one
      // "Cancel selection"; the selection bar holds the actions alone and
      // has no second "Clear selection".
      const bar = page.locator('[data-slot="bulk-action-bar"]')
      await expect(bar).toBeVisible()
      await expect(bar).not.toContainText("selected")
      await expect(
        page.locator('[data-slot="inbox-selected-count"]')
      ).toHaveText("1 selected")
      await expect(
        page.getByRole("button", { name: "Clear selection" })
      ).toHaveCount(0)
      await expect(
        page.getByRole("button", { name: "Cancel selection" })
      ).toHaveCount(1)
      // Untick from the box again.
      await boxes.first().tap()
      await expect(boxes.first()).toHaveAttribute("aria-checked", "false")
    })

    // R08 (INB-13, INB-16): a pushed review leads with the app bar and then
    // the review itself. There is no second head band, the name is written
    // once (as the page's h1), the steps sit on its row, and the text box is
    // the first control (touch-critical.spec.ts holds its top above half the
    // screen, on a review with no photo).
    test("a review opens with no head band, the text box first and its tones inside Generate", async ({
      baseURL,
      page,
    }) => {
      const state = await readJourneyState()
      await applyCookie(page, baseURL, state.cookie)
      await page.goto(`/inbox?selected=${state.directReview.id}`)
      const detail = page.getByRole("region", { name: "Selected review" })
      await expect(detail).toBeVisible()
      await expect(page.locator('[data-slot="review-head"]')).toHaveCount(0)
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1)
      const name = detail.locator('h1[data-slot="review-heading"]')
      await expect(name).toBeVisible()
      const steps = detail.locator('[data-slot="review-steps"]')
      await expect(
        steps.getByRole("button", { name: "Previous review" })
      ).toBeVisible()
      await expect(
        steps.getByRole("button", { name: "Next review" })
      ).toBeVisible()
      // The steps share the name's row with the ⋯ menu.
      const nameBox = (await name.boundingBox())!
      const stepsBox = (await steps.boundingBox())!
      expect(Math.abs(stepsBox.y - nameBox.y)).toBeLessThan(nameBox.height)
      // Generate and its tones are one control, under the box.
      const reply = detail.getByRole("textbox", { name: "Your reply" })
      await expect(reply).toBeVisible()
      await expect(
        detail.getByRole("radiogroup", { name: "Reply tone" })
      ).toHaveCount(0)
      await expect(
        detail.getByRole("button", { name: "Generate reply" })
      ).toBeVisible()
      // Guidance waits for text, and its marks are not radio-like circles.
      await expect(
        detail.getByRole("list", { name: "Reply guidance" })
      ).toHaveCount(0)
      await reply.fill("Thank you for visiting.")
      const guidance = detail.getByRole("list", { name: "Reply guidance" })
      await expect(guidance).toBeVisible()
      await expect(guidance.locator("svg.lucide-circle")).toHaveCount(0)
    })
  })

  // INB-08: one review is triaged where the reader is, not through Select
  // mode. These only open menus: the journey tenant's reviews are shared with
  // other specs, so nothing is marked or assigned here (the touch spec runs
  // the action, and its Undo, on a tenant of its own).
  test.describe("triage from the review", () => {
    test("the review's ⋯ carries Assign… and No reply needed", async ({
      baseURL,
      page,
    }) => {
      const state = await readJourneyState()
      await applyCookie(page, baseURL, state.cookie)
      await page.goto("/inbox")
      await page.locator('[data-slot="review-row"]').first().click()
      const detail = page.getByRole("region", { name: "Selected review" })
      await expect(detail).toBeVisible()

      await detail.getByRole("button", { name: "More actions" }).click()
      await expect(
        page.getByRole("menuitem", { name: "No reply needed" })
      ).toBeVisible()
      await page.getByRole("menuitem", { name: "Assign…" }).hover()
      await expect(
        page.getByRole("menuitem", { name: "Unassign" })
      ).toBeVisible()
      // The listing, history and details are still there.
      await expect(
        page.getByRole("menuitem", { name: "History" })
      ).toBeVisible()
    })

    test("a viewer is offered neither", async ({ baseURL, page }) => {
      const state = await readJourneyState()
      await applyCookie(page, baseURL, state.viewerCookie)
      await page.goto("/inbox")
      await expect(
        page.locator('[data-slot="review-row"]').first()
      ).toBeVisible()
      await expect(
        page.getByRole("button", { name: /^Actions for / })
      ).toHaveCount(0)

      await page.locator('[data-slot="review-row"]').first().click()
      const detail = page.getByRole("region", { name: "Selected review" })
      await detail.getByRole("button", { name: "More actions" }).click()
      await expect(
        page.getByRole("menuitem", { name: "Open listing" })
      ).toBeVisible()
      await expect(
        page.getByRole("menuitem", { name: "No reply needed" })
      ).toHaveCount(0)
      await expect(page.getByRole("menuitem", { name: "Assign…" })).toHaveCount(
        0
      )
    })
  })

  test("offers a location filter only when the org has several locations", async ({
    baseURL,
    page,
  }) => {
    // The no-cookie LOCAL_BOOTSTRAP org is single-location, so the filter is
    // deliberately hidden there; the journey tenant seeds two locations
    // (tests/e2e/helpers/stub-bridge.ts) and is the case that needs it.
    await page.goto("/inbox")
    await expect(
      page.getByRole("searchbox", { name: "Search reviews" })
    ).toBeVisible()
    await expect(
      page.getByRole("combobox", { name: "Filter by location" })
    ).toBeHidden()

    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto("/inbox")
    // The venue filter lives in the Filters sheet at every width.
    await page.getByRole("button", { name: /^Filters/ }).click()
    await expect(
      page
        .getByRole("dialog", { name: "Filters" })
        .getByRole("combobox", { name: "Filter by location" })
    ).toBeVisible()
  })

  test("reviews redirects to inbox and forwards the query string", async ({
    page,
  }) => {
    // /reviews -> /inbox forwards the query string (app/reviews/page.tsx). The
    // shared local LOCAL_BOOTSTRAP org carries many reviews, so the inbox's
    // desktop auto-selection (components/inbox/inbox-view.tsx) picks the
    // first queued review and client-rewrites the URL to append
    // `selected=<id>` shortly after landing. An exact toHaveURL assertion
    // races that rewrite — assert the landed pathname and (where
    // applicable) that the forwarded query param survived instead, which
    // holds true whether or not the auto-select rewrite has fired yet (see
    // the identical hardening in tests/e2e/routing.spec.ts).
    await page.goto("/reviews")
    expect(new URL(page.url()).pathname).toBe("/inbox")
    await page.goto("/reviews?queue=needs_reply")
    const url = new URL(page.url())
    expect(url.pathname).toBe("/inbox")
    expect(url.searchParams.get("queue")).toBe("needs_reply")
  })

  for (const theme of ["light", "dark"] as const) {
    test(`is free of console and page errors (${theme})`, async ({ page }) => {
      const consoleErrors: string[] = []
      const pageErrors: string[] = []
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text())
      })
      page.on("pageerror", (error) => pageErrors.push(error.message))
      await page.emulateMedia({ colorScheme: theme })
      await page.goto("/inbox")
      // Anchored on the search box, not the location combobox: the latter is
      // hidden for single-location orgs, which would couple this a11y sweep to
      // tenant shape.
      await expect(
        page.getByRole("searchbox", { name: "Search reviews" })
      ).toBeVisible()
      await page.waitForLoadState("networkidle")
      expect(consoleErrors, `${theme} console`).toEqual([])
      expect(pageErrors, `${theme} pageerror`).toEqual([])
    })

    test(`is axe-clean including structure (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      await page.goto("/inbox")
      // Anchored on the search box, not the location combobox: the latter is
      // hidden for single-location orgs, which would couple this a11y sweep to
      // tenant shape.
      await expect(
        page.getByRole("searchbox", { name: "Search reviews" })
      ).toBeVisible()
      await page.waitForLoadState("networkidle")
      const wcag = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
      expect(wcag.violations, `${theme} wcag`).toEqual([])
      const best = await new AxeBuilder({ page })
        .withTags(["best-practice"])
        .analyze()
      expect(
        best.violations.filter((v) => STRUCTURE_RULES.includes(v.id)),
        `${theme} structure`
      ).toEqual([])
    })
  }

  // R1 (Task 3, security headers): the CSP's img-src allow-list must let a
  // real Google-hosted review thumbnail render client-side (review-detail.tsx
  // renders `thumbnailUrl` directly as an <img src>, with no image proxy).
  // The route intercepts the request so no real network call is made, but
  // the request URL - and therefore the CSP check the browser runs against
  // it - is the real googleusercontent.com host the CSP allow-lists.
  test("a review thumbnail on a Google media host renders under the CSP", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.route(`${state.directReview.media.thumbnailUrl}*`, (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: ONE_PX_PNG })
    )

    const cspViolations: string[] = []
    page.on("console", (message) => {
      if (/content security policy/i.test(message.text())) {
        cspViolations.push(message.text())
      }
    })

    await page.goto("/inbox")
    await page
      .getByRole("button")
      .filter({ hasText: state.directReview.text })
      .first()
      .click()
    await expect(
      page
        .getByRole("region", { name: "Selected review" })
        .getByText(state.directReview.text, { exact: true })
    ).toBeVisible()

    // The grid thumbnail is deliberately DECORATIVE (`alt=""`): its wrapping
    // button carries the accessible name ("Open <label>"), so naming the image
    // as well would announce the same photo twice (review-detail.tsx's
    // ReviewMedia). Only the lightbox copy takes `alt={label}`, and that one
    // needs a click first — so reach the rendered <img> through the button
    // that names it rather than by an img role that the accessibility tree
    // (correctly) does not expose.
    const img = page
      .getByRole("button", {
        name: `Open ${state.directReview.media.thumbnailLabel}`,
      })
      .locator("img")
    await expect(img).toBeVisible()
    // naturalWidth > 0 is the actual CSP proof: the browser fetched and decoded
    // a googleusercontent.com image, which img-src had to allow. Polled rather
    // than read once — the thumbnail is `loading="lazy"`, so a visible <img>
    // is not yet a decoded one, and a blocked image simply never gets there.
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0)
    expect(cspViolations).toEqual([])
  })

  test.describe("on a touch phone, offline for new code", () => {
    test.use({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    })

    // R09: the bulk bar's code is fetched when the first row is ticked. If that
    // download fails, the Inbox carries on: the list and the selection stay, a
    // notice offers "Try again", and the route's error boundary is never reached.
    test("a bulk bar that fails to download keeps the list and the selection, and Try again recovers", async ({
      baseURL,
      page,
    }) => {
      const state = await readJourneyState()
      await applyCookie(page, baseURL, state.cookie)
      // No idle preload, so the bar's code is first asked for by the tick.
      await page.addInitScript(() => {
        Object.defineProperty(window, "requestIdleCallback", {
          configurable: true,
          value: () => 0,
        })
      })
      await page.goto("/inbox")
      const boxes = page.getByRole("checkbox", {
        name: /^Select the review from /,
      })
      await page.getByRole("button", { name: "Select", exact: true }).tap()
      await expect(boxes.first()).toBeVisible()
      // Every script the page has not already fetched is refused from here on.
      const refused: string[] = []
      let offline = true
      await page.route(/\/_next\/static\/chunks\/.*\.js/, (route) => {
        if (!offline) return route.continue()
        refused.push(route.request().url())
        return route.abort()
      })
      await boxes.first().tap()
      await expect(boxes.first()).toHaveAttribute("aria-checked", "true")

      const notice = page.locator('[data-slot="bulk-action-bar-failed"]')
      await expect(notice).toBeVisible()
      // Pinned to the bottom edge of the phone, not lost under the rows.
      await expect(notice).toBeInViewport({ ratio: 1 })
      await expect(notice).toContainText(
        "The selection actions could not load."
      )
      expect(refused.length).toBeGreaterThan(0)
      // The view and the selection are untouched, and the route did not fail.
      await expect(
        page.getByRole("heading", { name: "Inbox", level: 1 })
      ).toBeVisible()
      await expect(
        page.locator('[data-slot="inbox-selected-count"]')
      ).toHaveText("1 selected")
      await expect(boxes.first()).toHaveAttribute("aria-checked", "true")
      await expect(
        page.locator('[data-slot="boundary-error-state"]')
      ).toHaveCount(0)

      // The connection is back: Try again brings the real bar, and focus stays
      // on the page rather than dropping to the body.
      offline = false
      await notice.getByRole("button", { name: "Try again" }).tap()
      const bar = page.locator('[data-slot="bulk-action-bar"]')
      await expect(bar).toBeVisible()
      await expect(notice).toHaveCount(0)
      await expect(
        page.locator('[data-slot="inbox-selected-count"]')
      ).toHaveText("1 selected")
      await expect
        .poll(() =>
          page.evaluate(() => document.activeElement !== document.body)
        )
        .toBe(true)
    })
  })

  // R08 (DSK-22): a thumbnail that will not load (an expired Google CDN link,
  // here an aborted request) swaps to the tile's placeholder instead of the
  // browser's broken-image glyph, and the tile still opens.
  test("a review photo that fails to load shows a placeholder, not a broken image", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.route(`${state.directReview.media.thumbnailUrl}*`, (route) =>
      route.abort()
    )
    await page.goto(`/inbox?selected=${state.directReview.id}`)
    const tile = page.getByRole("button", {
      name: `Open ${state.directReview.media.thumbnailLabel}`,
    })
    const placeholder = tile.locator('[data-slot="media-unavailable"]')
    await expect(placeholder).toBeVisible()
    await expect(placeholder).toHaveAttribute("title", "Photo unavailable")
    await expect(tile.locator("img")).toHaveCount(0)
  })
})
