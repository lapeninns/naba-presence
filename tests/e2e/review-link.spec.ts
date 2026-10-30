import AxeBuilder from "@axe-core/playwright"
import {
  type APIRequestContext,
  type Browser,
  expect,
  type Page,
  type PlaywrightWorkerArgs,
  test,
} from "@playwright/test"

import {
  GOOGLE_READS_TIMEOUT,
  pageSettled,
  trackRequests,
} from "./helpers/settled"
import { readJourneyState } from "./helpers/stub-bridge"

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
const STRUCTURE_RULES = [
  "landmark-no-duplicate-main",
  "landmark-main-is-top-level",
  "heading-order",
  "page-has-heading-one",
]

/** The stub's `metadata.newReviewUri` for the seeded primary location. */
const GOOGLE_REVIEW_FORM = "https://g.page/x/review"
/** A well-formed code (the 31-letter alphabet) that no link has. */
const UNKNOWN_CODE = "2222222222"
const CODE_IN_URL = /\/r\/([2-9a-hjkmnp-z]{10})$/
const NOT_WORKING = "This review link isn’t working any more"

/**
 * A guest's phone. The /r route counts no open from a likely bot
 * (lib/domain/review-link.ts isLikelyBot), and that includes Chromium's
 * headless user agent ("HeadlessChrome") and an empty one. Playwright's own
 * API user agent ("Playwright/…") passes the filter today, but every guest
 * request names a real browser so the counts never depend on it.
 */
const GUEST_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1"
const HEADLESS_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36"

async function applyCookie(
  page: Page,
  baseURL: string | undefined,
  cookie: string
) {
  const [name, value] = cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
}

const reviewLinkPath = (locationId: string) =>
  `/listings/${locationId}/review-link`

const linkCard = (page: Page) => page.locator('[data-slot="review-link-card"]')
const linkField = (page: Page) =>
  page.getByRole("textbox", { name: "Link", exact: true })

async function openReviewLink(page: Page, locationId: string) {
  await page.goto(reviewLinkPath(locationId))
  await expect(
    page.getByRole("heading", { name: "Review link", level: 1 })
  ).toBeVisible()
}

/** The code at the end of the link the page shows. */
async function shownCode(page: Page): Promise<string> {
  const url = await linkField(page).inputValue()
  const code = CODE_IN_URL.exec(url)?.[1]
  expect(code, `a review link code in ${url}`).toBeTruthy()
  return code!
}

/**
 * Brings the owner's page to a live link and returns its code: reads Google
 * for the review form if none is stored yet, creates the link if there is
 * none, and switches it back on if a step left it off. Each test starts from
 * here, so any one of them can run on its own.
 */
async function ensureLiveLink(page: Page, locationId: string) {
  await openReviewLink(page, locationId)
  const missing = page.getByRole("heading", {
    name: "Google hasn’t given a review link yet",
  })
  const create = page.getByRole("button", { name: "Create review link" })
  const card = page.getByRole("heading", { name: "Your review link" })
  await expect(missing.or(create).or(card)).toBeVisible({
    timeout: GOOGLE_READS_TIMEOUT,
  })
  if (await missing.isVisible()) {
    // The Business Information read, against the stub, which stores Google's
    // review form with the listing's details.
    await page.getByRole("button", { name: "Check Google now" }).click()
    await expect(create).toBeVisible({ timeout: GOOGLE_READS_TIMEOUT })
  }
  if (await create.isVisible()) {
    await create.click()
    await expect(card).toBeVisible()
  }
  const switchOn = linkCard(page).getByRole("button", {
    name: "Switch back on",
  })
  if (await switchOn.isVisible()) {
    await switchOn.click()
  }
  await expect(linkCard(page).getByText("Live", { exact: true })).toBeVisible()
  await expect(linkField(page)).toHaveValue(CODE_IN_URL)
  return shownCode(page)
}

/** A cookie-less client: no session, as a guest scanning a table talker. */
function guest(
  playwright: PlaywrightWorkerArgs["playwright"],
  baseURL: string | undefined,
  userAgent = GUEST_UA
): Promise<APIRequestContext> {
  return playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { "user-agent": userAgent },
  })
}

async function expectRedirect(client: APIRequestContext, path: string) {
  const response = await client.get(path, { maxRedirects: 0 })
  expect(response.status(), `${path} status`).toBe(302)
  expect(response.headers()["location"], `${path} location`).toBe(
    GOOGLE_REVIEW_FORM
  )
}

async function expectNotWorking(
  client: APIRequestContext,
  path: string,
  venueName: string
) {
  const response = await client.get(path, { maxRedirects: 0 })
  expect(response.status(), `${path} status`).toBe(404)
  const body = await response.text()
  expect(body).toContain(NOT_WORKING)
  // A probe learns nothing: the page names no venue.
  expect(body).not.toContain(venueName)
}

/** The figure in the stats card's KPI tile with this label. */
async function kpiFigure(page: Page, label: string): Promise<number> {
  const tile = page
    .locator('[data-slot="kpi-tile"]')
    .filter({ hasText: label })
    .first()
  await expect(tile).toBeVisible({ timeout: GOOGLE_READS_TIMEOUT })
  const text = (await tile.textContent()) ?? ""
  const figure = new RegExp(`${label}\\s*([\\d,]+)`).exec(text)?.[1]
  expect(figure, `${label} figure in "${text}"`).toBeTruthy()
  return Number(figure!.replace(/,/g, ""))
}

async function confirm(page: Page, button: string) {
  const dialog = page.getByRole("alertdialog")
  await expect(dialog).toBeVisible()
  await dialog.getByRole("button", { name: button, exact: true }).click()
  await expect(dialog).toBeHidden()
}

// One review link per listing, and these tests change it (create, rotate,
// switch off). Each starts from ensureLiveLink, so none relies on another
// having run, but they must not interleave: the config runs one worker, and
// serial keeps them in this order within the file.
test.describe.serial("review link", () => {
  test("the owner creates the link, and the page passes axe on a phone and a desk", async ({
    baseURL,
    page,
  }) => {
    const consoleErrors: string[] = []
    const pageErrors: string[] = []
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text())
    })
    page.on("pageerror", (error) => pageErrors.push(error.message))
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.emulateMedia({ colorScheme: "light" })
    await page.setViewportSize({ width: 390, height: 844 })

    await ensureLiveLink(page, state.primaryLocationId)
    await expect(
      page.getByRole("heading", { name: "Your review link" })
    ).toBeVisible()
    await expect(linkField(page)).toHaveAttribute("readonly", "")
    await expect(
      page.getByRole("link", { name: /Open the Google review form/ })
    ).toHaveAttribute("href", GOOGLE_REVIEW_FORM)

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1280, height: 800 },
    ]) {
      const label = `${viewport.width}x${viewport.height}`
      const requests = trackRequests(page)
      await page.setViewportSize(viewport)
      await page.reload()
      await expect(
        page.getByRole("heading", { name: "Your review link" })
      ).toBeVisible()
      await expect(
        page.getByRole("heading", { name: "Opens and new reviews" })
      ).toBeVisible()
      await pageSettled(page)
      await requests.idle()
      const wcag = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
      expect(wcag.violations, `${label} wcag`).toEqual([])
      const best = await new AxeBuilder({ page })
        .withTags(["best-practice"])
        .analyze()
      expect(
        best.violations.filter((v) => STRUCTURE_RULES.includes(v.id)),
        `${label} structure`
      ).toEqual([])
    }
    expect(consoleErrors, "console").toEqual([])
    expect(pageErrors, "pageerror").toEqual([])
  })

  test("the public link redirects without a session, and an unknown code names no venue", async ({
    baseURL,
    page,
    playwright,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    const code = await ensureLiveLink(page, state.primaryLocationId)

    const client = await guest(playwright, baseURL)
    try {
      await expectRedirect(client, `/r/${code}`)
      await expectRedirect(client, `/r/${code}?s=qr`)
      const unknown = await client.get(`/r/${UNKNOWN_CODE}`, {
        maxRedirects: 0,
      })
      expect(unknown.headers()["x-robots-tag"]).toContain("noindex")
      await expectNotWorking(
        client,
        `/r/${UNKNOWN_CODE}`,
        state.directReview.locationName
      )
    } finally {
      await client.dispose()
    }
  })

  test("a new link stops the old code, and switching off and on again follows", async ({
    baseURL,
    page,
    playwright,
  }) => {
    const state = await readJourneyState()
    const venue = state.directReview.locationName
    await applyCookie(page, baseURL, state.cookie)
    const oldCode = await ensureLiveLink(page, state.primaryLocationId)
    const oldUrl = await linkField(page).inputValue()
    const client = await guest(playwright, baseURL)
    try {
      await linkCard(page)
        .getByRole("button", { name: "Make a new link" })
        .click()
      await expect(page.getByRole("alertdialog")).toContainText(
        "every printed QR code stop working"
      )
      await confirm(page, "Make a new link")
      await expect(linkField(page)).not.toHaveValue(oldUrl)
      await expect(linkField(page)).toHaveValue(CODE_IN_URL)
      const newCode = await shownCode(page)
      expect(newCode).not.toBe(oldCode)
      await expectNotWorking(client, `/r/${oldCode}`, venue)
      await expectRedirect(client, `/r/${newCode}`)

      await linkCard(page).getByRole("button", { name: "Switch off" }).click()
      await confirm(page, "Switch off")
      await expect(
        linkCard(page).getByText("Switched off", { exact: true })
      ).toBeVisible()
      await expectNotWorking(client, `/r/${newCode}`, venue)

      await linkCard(page)
        .getByRole("button", { name: "Switch back on" })
        .click()
      await expect(
        linkCard(page).getByText("Live", { exact: true })
      ).toBeVisible()
      // Switching on keeps the code: the printed codes work again.
      expect(await shownCode(page)).toBe(newCode)
      await expectRedirect(client, `/r/${newCode}`)
    } finally {
      await client.dispose()
    }
  })

  test("opens are counted, by source, and a headless browser's are not", async ({
    baseURL,
    page,
    playwright,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    const code = await ensureLiveLink(page, state.primaryLocationId)
    await expect(
      page.getByRole("heading", { name: "Opens and new reviews" })
    ).toBeVisible()
    await pageSettled(page)
    const before = await kpiFigure(page, "Link opens")
    const qrBefore = await kpiFigure(page, "From the QR code")

    // A headless browser is a likely bot: redirected, never counted.
    const headless = await guest(playwright, baseURL, HEADLESS_UA)
    const phone = await guest(playwright, baseURL)
    try {
      await expectRedirect(headless, `/r/${code}`)
      await expectRedirect(phone, `/r/${code}`)
      await expectRedirect(phone, `/r/${code}?s=qr`)
    } finally {
      await headless.dispose()
      await phone.dispose()
    }

    // Opens are recorded after the redirect is answered: read until they land.
    await expect(async () => {
      await page.reload()
      await pageSettled(page)
      expect(await kpiFigure(page, "Link opens")).toBe(before + 2)
      expect(await kpiFigure(page, "From the QR code")).toBe(qrBefore + 1)
    }).toPass({ timeout: GOOGLE_READS_TIMEOUT })
    expect(await kpiFigure(page, "Link opens")).toBeGreaterThanOrEqual(2)
    await expect(
      page.getByText("No opens or new reviews in this period.")
    ).toHaveCount(0)
  })

  test("the QR code is drawn, and both downloads save a file", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    const code = await ensureLiveLink(page, state.primaryLocationId)
    const image = page.locator('[data-slot="review-link-qr"]')
    await expect(image).toBeVisible()
    // The image is a real, loaded picture, not a broken data URI.
    expect(
      await image.evaluate((node) => (node as HTMLImageElement).naturalWidth)
    ).toBeGreaterThan(0)
    for (const [name, extension] of [
      ["Download SVG", "svg"],
      ["Download PNG", "png"],
    ] as const) {
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name }).click(),
      ])
      expect(download.suggestedFilename()).toBe(
        `review-qr-${code}.${extension}`
      )
      const path = await download.path()
      expect(path, `${name} saved`).toBeTruthy()
    }
  })

  test("a viewer sees the link but cannot change it", async ({
    baseURL,
    browser,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await ensureLiveLink(page, state.primaryLocationId)
    const url = await linkField(page).inputValue()

    const viewer = await signedIn(browser, baseURL, state.viewerCookie)
    try {
      await openReviewLink(viewer, state.primaryLocationId)
      await expect(
        viewer.getByRole("heading", { name: "Your review link" })
      ).toBeVisible()
      await expect(linkField(viewer)).toHaveValue(url)
      await expect(
        viewer.getByRole("button", { name: "Copy link" })
      ).toBeVisible()
      await expect(
        viewer.getByText(
          "Someone who can edit this listing can make a new link or switch it off."
        )
      ).toBeVisible()
      for (const name of [
        "Make a new link",
        "Switch off",
        "Switch back on",
        "Check Google now",
      ]) {
        await expect(viewer.getByRole("button", { name })).toHaveCount(0)
      }
      await expect(
        viewer.getByRole("textbox", { name: /Caption under the code/ })
      ).toHaveCount(0)
    } finally {
      await viewer.context().close()
    }
  })
})

async function signedIn(
  browser: Browser,
  baseURL: string | undefined,
  cookie: string
): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await applyCookie(page, baseURL, cookie)
  return page
}
