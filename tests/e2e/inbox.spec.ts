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
    // than by name, because each control's accessible name also carries its
    // count ("Needs reply, 12 reviews").
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
    await expect(
      page.getByRole("combobox", { name: "Filter by location" })
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
