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
  // locat…"). The pill now drops under the venue below sm (24rem), and the
  // venue wraps (two lines at most) instead of truncating.
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
        // Every word of the client · location is drawn: nothing is cut off.
        const clipped = await location.evaluate(
          (node) =>
            node.scrollWidth > node.clientWidth + 1 ||
            node.scrollHeight > node.clientHeight + 1
        )
        expect(clipped).toBe(false)
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
      // QA #11: the selection bar says how many once, with its one "Clear
      // selection"; the band keeps its one "Cancel selection".
      const bar = page.locator('[data-slot="bulk-action-bar"]')
      await expect(bar).toContainText("1 selected")
      await expect(page.getByText(/\d+ selected$/)).toHaveCount(1)
      await expect(
        page.getByRole("button", { name: "Clear selection" })
      ).toHaveCount(1)
      await expect(
        page.getByRole("button", { name: "Cancel selection" })
      ).toHaveCount(1)
      // Untick from the box again.
      await boxes.first().tap()
      await expect(boxes.first()).toHaveAttribute("aria-checked", "false")
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
})
