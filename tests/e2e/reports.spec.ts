import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, test } from "@playwright/test"

import { pageSettled, trackRequests } from "./helpers/settled"
import { readJourneyState } from "./helpers/stub-bridge"

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
const STRUCTURE_RULES = [
  "landmark-no-duplicate-main",
  "landmark-main-is-top-level",
  "heading-order",
  "page-has-heading-one",
]

async function applyCookie(
  page: Page,
  baseURL: string | undefined,
  cookie: string
) {
  const [name, value] = cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
}

// Every test in this file runs as the journey org's owner (seeded in
// stub-bridge.ts with performance/keyword rows against its linked location),
// not the default no-cookie local-bootstrap session - that org has zero
// locations by design (see 20260729000400_remove_local_demo_data), so the
// "seeded ready" Google-performance and keywords assertions below would be
// unreachable without it, and the clean-load/axe guards would only ever
// exercise the empty-state panels rather than the populated chart/table
// paths they are meant to prove clean.
test.describe("reports", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
  })

  test("exposes three tabs and defaults to reply performance", async ({
    page,
  }) => {
    await page.goto("/reports")
    await expect(page).toHaveURL("/reports")
    await expect(
      page.getByRole("heading", { name: "Reports", level: 1 })
    ).toBeVisible()
    await expect(
      page.getByRole("tab", { name: "Reply performance" })
    ).toHaveAttribute("aria-selected", "true")
    await expect(
      page.getByRole("tab", { name: "Google performance" })
    ).toBeVisible()
    await expect(page.getByRole("tab", { name: "Keywords" })).toBeVisible()
  })

  test("puts the active tab in the URL and restores it on reload", async ({
    page,
  }) => {
    await page.goto("/reports")
    await page.getByRole("tab", { name: "Keywords" }).click()
    await expect(page).toHaveURL(/[?&]tab=keywords/)
    await page.reload()
    await expect(page.getByRole("tab", { name: "Keywords" })).toHaveAttribute(
      "aria-selected",
      "true"
    )
  })

  test("reply performance shows KPI tiles, a prior-period delta, and the by-listing table", async ({
    page,
  }) => {
    await page.goto("/reports")
    // "Reviews" labels both the KPI tile and the by-listing table's column
    // header; the KPI grid renders first in DOM order, so .first() resolves
    // the strict-mode ambiguity deterministically rather than guessing.
    await expect(
      page.getByText("Reviews", { exact: true }).first()
    ).toBeVisible()
    await expect(page.getByText("Response rate").first()).toBeVisible()
    // Non-colour delta cue: an arrow glyph (an SVG, aria-hidden) sits beside
    // the signed magnitude, and the direction is spoken through a
    // visually-hidden word so a screen reader hears "Up +2" rather than a
    // bare number. The journey org has 2 reviews in the current 30-day
    // window and 0 in the prior window, so the Reviews KPI renders a real
    // delta; match the spoken form, which includes the hidden word.
    const delta = page.getByText(/(Up|Down|No change)\s*[+±−]/).first()
    await expect(delta).toBeVisible()
    await expect(delta.locator("svg")).toHaveCount(1)
    await expect(
      page.getByRole("columnheader", { name: "Listing" })
    ).toBeVisible()
  })

  test("google performance renders humanised metric tiles (seeded ready)", async ({
    page,
  }) => {
    await page.goto("/performance?tab=google")
    // The same words also name the actions chart's series; the tiles come
    // first in the DOM.
    await expect(
      page.getByText("Call button taps", { exact: true }).first()
    ).toBeVisible()
    await expect(
      page.getByText("Website clicks", { exact: true }).first()
    ).toBeVisible()
  })

  test("keywords tab shows honest 'N+' for a thresholded term (seeded ready)", async ({
    page,
  }) => {
    await page.goto("/performance?tab=keywords")
    await expect(page.getByText("riverside hotel bath")).toBeVisible()
    await expect(page.getByText("1,000+")).toBeVisible()
  })

  test("analytics redirects to performance", async ({ page }) => {
    await page.goto("/analytics")
    await expect(page).toHaveURL("/reports")
  })

  // The scope is the app bar's chip and the period one tap, on a phone (CLR-01,
  // CLR-02, CLR-24). The same viewport and touch settings as the touch-390
  // project, but the unnamed project's browser, so the file's seeded owner
  // cookie and its other cases stay as they are.
  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

    test("the period is one tap away, with no second scope control or sheet", async ({
      page,
    }) => {
      await page.goto("/reports?tab=google")
      const period = page.getByRole("group", { name: "Period" })
      await expect(
        period.getByRole("button", { name: "Last 28 days" })
      ).toHaveAttribute("aria-pressed", "true")
      await period.getByRole("button", { name: "Last 90 days" }).tap()
      await expect(page).toHaveURL(/[?&]range=90d/)
      await expect(
        period.getByRole("button", { name: "Last 90 days" })
      ).toHaveAttribute("aria-pressed", "true")
      // The page's own scope pill (and its sheet of selects) is gone.
      await expect(
        page.getByRole("button", {
          name: /^Journey Hospitality.*Last 90 days$/,
        })
      ).toHaveCount(0)
      await expect(page.getByRole("dialog")).toHaveCount(0)
    })

    test("choosing a client and a period takes three taps", async ({
      page,
    }) => {
      const state = await readJourneyState()
      await page.goto("/reports?tab=google")
      // The journey org has one client, so the app bar shows no scope chip
      // (there is nothing to switch between) and the report keeps its own
      // Client field on a phone. Tap 1: the field. Tap 2: the client. Tap 3: the period.
      await expect(
        page
          .locator('header[data-slot="app-bar"]')
          .getByRole("button", { name: /^Client:/ })
      ).toHaveCount(0)
      await page.getByRole("combobox", { name: /Client/ }).tap()
      await page
        .getByRole("option", { name: new RegExp(`^${state.clientName}`) })
        .tap()
      await expect(page).toHaveURL(new RegExp(`[?&]clientId=${state.clientId}`))
      await page
        .getByRole("group", { name: "Period" })
        .getByRole("button", { name: "Last 12 months" })
        .tap()
      await expect(page).toHaveURL(/[?&]range=12m/)
      await expect(page).toHaveURL(new RegExp(`[?&]clientId=${state.clientId}`))
    })

    test("switching tab keeps each tab's period and says when one is carried over", async ({
      page,
    }) => {
      await page.goto("/reports?tab=google&range=90d")
      await page.getByRole("tab", { name: "Keywords" }).tap()
      await expect(page).toHaveURL(/[?&]tab=keywords/)
      // Nothing is dropped from the address, and Keywords says what it shows.
      await expect(page).toHaveURL(/[?&]range=90d/)
      await expect(
        page
          .getByRole("group", { name: "Period" })
          .getByRole("button", { name: "Last 6 months" })
      ).toHaveAttribute("aria-pressed", "true")
      await expect(
        page.getByText(
          "Keywords count whole months: showing the last 6 months."
        )
      ).toBeVisible()
      await page
        .getByRole("group", { name: "Period" })
        .getByRole("button", { name: "Last 12 months" })
        .tap()
      await expect(page).toHaveURL(/[?&]range_kw=12m/)
      // Back on Google, the period chosen there is still there.
      await page.getByRole("tab", { name: "Google performance" }).tap()
      await expect(
        page
          .getByRole("group", { name: "Period" })
          .getByRole("button", { name: "Last 90 days" })
      ).toHaveAttribute("aria-pressed", "true")
    })

    test("keywords carries Google's default period as one month, with its note", async ({
      page,
    }) => {
      await page.goto("/reports?tab=google")
      await page.getByRole("tab", { name: "Keywords" }).tap()
      await expect(page).toHaveURL(/[?&]range=28d/)
      await expect(
        page
          .getByRole("group", { name: "Period" })
          .getByRole("button", { name: "Last month" })
      ).toHaveAttribute("aria-pressed", "true")
      await expect(
        page.getByText("Keywords count whole months: showing the last month.")
      ).toBeVisible()
    })

    test("keywords opens on its own 6 months, unannounced, when landed on directly", async ({
      page,
    }) => {
      await page.goto("/reports?tab=keywords")
      await expect(
        page
          .getByRole("group", { name: "Period" })
          .getByRole("button", { name: "Last 6 months" })
      ).toHaveAttribute("aria-pressed", "true")
      await expect(page.getByText(/Keywords count whole months/)).toHaveCount(0)
    })

    test("the first figure is on the first screen of the Google tab", async ({
      page,
    }) => {
      await page.goto("/reports?tab=google")
      await expect(
        page.getByText("Call button taps", { exact: true }).first()
      ).toBeVisible()
      await expect(
        page.locator("[data-slot=kpi-tile]").first()
      ).toBeInViewport()
      // Provenance is a caption, and Refresh is in the menu, not above the figures.
      await expect(
        page.getByRole("button", { name: "About these figures" })
      ).toBeVisible()
      await expect(
        page.getByRole("button", { name: "Refresh from Google" })
      ).toHaveCount(0)
    })

    test("refresh and sharing are in the actions menu", async ({ page }) => {
      await page.goto("/reports?tab=google")
      await page.getByRole("button", { name: "More actions" }).tap()
      await expect(
        page.getByRole("menuitem", { name: "Refresh from Google" })
      ).toBeVisible()
      // With every client in scope the menu asks which client to share.
      await expect(
        page.getByRole("menuitem", { name: /^Share (a client’s )?report$/ })
      ).toBeVisible()
    })
  })

  for (const theme of ["light", "dark"] as const) {
    test(`is free of console and page errors (${theme})`, async ({ page }) => {
      const consoleErrors: string[] = []
      const pageErrors: string[] = []
      page.on("console", (m) => {
        if (m.type() === "error") consoleErrors.push(m.text())
      })
      page.on("pageerror", (e) => pageErrors.push(e.message))
      const requests = trackRequests(page)
      await page.emulateMedia({ colorScheme: theme })
      await page.goto("/reports")
      await expect(
        page.getByRole("tab", { name: "Reply performance" })
      ).toBeVisible()
      await page.getByRole("tab", { name: "Google performance" }).click()
      await page.getByRole("tab", { name: "Keywords" }).click()
      await expect(
        page.getByRole("tab", { name: "Keywords", selected: true })
      ).toBeVisible()
      await pageSettled(page)
      await requests.idle()
      expect(consoleErrors, `${theme} console`).toEqual([])
      expect(pageErrors, `${theme} pageerror`).toEqual([])
    })

    test(`is axe-clean including structure (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      await page.goto("/reports")
      await expect(
        page.getByRole("heading", { name: "Reports", level: 1 })
      ).toBeVisible()
      await pageSettled(page)
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
})

// Sharing a client's report (R14): the owner's share sheet on the client hub,
// and the public, tokenised /share/report/<token> page it hands out. Kept in
// its own block, after the reports suite, so it stands on its own. The link
// is created through the real sheet (the shown-once URL is read from the
// field) and revoked at the end of the test that made it.
test.describe("sharing a client report", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
  })

  async function openShareSheet(page: Page, clientId: string) {
    await page.goto(`/clients/${clientId}`)
    await page
      .getByRole("button", { name: "More actions", exact: true })
      .click()
    await page.getByRole("menuitem", { name: "Share report" }).click()
    const dialog = page.getByRole("dialog")
    await expect(
      dialog.getByRole("heading", { name: /^Share .*report$/ })
    ).toBeVisible()
    return dialog
  }

  test("the share sheet keeps its action in the footer and its lengths as radio rows", async ({
    page,
  }) => {
    const state = await readJourneyState()
    const dialog = await openShareSheet(page, state.clientId)
    const group = dialog.getByRole("radiogroup", { name: "Link works for" })
    await expect(group.getByRole("radio")).toHaveCount(3)
    await expect(group.getByRole("radio", { name: "90 days" })).toHaveAttribute(
      "aria-checked",
      "true"
    )
    await group.getByRole("radio", { name: "30 days" }).click()
    await expect(group.getByRole("radio", { name: "30 days" })).toHaveAttribute(
      "aria-checked",
      "true"
    )
    // Create link sits in the sheet's footer, not mid-sheet.
    const footer = dialog.locator('[data-slot="dialog-footer"]')
    await expect(
      footer.getByRole("button", { name: "Create link" })
    ).toBeVisible()
    await expect(
      dialog
        .locator('[data-slot="dialog-body"]')
        .getByRole("button", { name: "Create link" })
    ).toHaveCount(0)
  })

  test("creates a link, shows it once with Copy in the footer, lists it and revokes it", async ({
    page,
  }) => {
    const state = await readJourneyState()
    const dialog = await openShareSheet(page, state.clientId)
    await dialog
      .locator('[data-slot="dialog-footer"]')
      .getByRole("button", { name: "Create link" })
      .click()

    const field = dialog.getByRole("textbox", { name: "Report link" })
    await expect(field).toHaveValue(/\/share\/report\/[\w-]{20,}$/)
    const footer = dialog.locator('[data-slot="dialog-footer"]')
    await expect(
      footer.getByRole("button", { name: "Copy link" })
    ).toBeVisible()
    await expect(
      footer.getByRole("button", { name: "Create link" })
    ).toHaveCount(0)
    await expect(dialog.getByText(/shown only this once/)).toBeVisible()

    // It is listed under the sheet as a live link, with a Revoke beside it.
    await expect(
      dialog.getByRole("listitem").filter({ hasText: "Active" }).first()
    ).toContainText(/Expires /)
    await dialog
      .getByRole("button", { name: /^Revoke the link/ })
      .first()
      .click()
    const confirm = page.getByRole("alertdialog", { name: "Revoke this link?" })
    await confirm.getByRole("button", { name: "Revoke link" }).click()
    await expect(page.getByText("Link revoked")).toBeVisible()
  })

  test("the public report leads with the name and period, keeps metadata in the footer, and period links return to the figures", async ({
    browser,
    page,
    baseURL,
  }) => {
    const state = await readJourneyState()
    const dialog = await openShareSheet(page, state.clientId)
    await dialog
      .locator('[data-slot="dialog-footer"]')
      .getByRole("button", { name: "Create link" })
      .click()
    const url = await dialog
      .getByRole("textbox", { name: "Report link" })
      .inputValue()
    const path = new URL(url).pathname

    // A reader with no account and no cookie.
    const reader = await browser.newContext({ baseURL })
    try {
      const shared = await reader.newPage()
      await shared.goto(path)
      await expect(
        shared.getByRole("heading", { name: state.clientName, level: 1 })
      ).toBeVisible()

      const header = shared.getByRole("banner")
      await expect(header.getByText(/Last 28 days/).first()).toBeVisible()
      await expect(
        header.getByRole("navigation", { name: "Report period" })
      ).toBeVisible()
      // The four metadata rows are not up there any more.
      await expect(header.locator("dl")).toHaveCount(0)

      const footer = shared.getByRole("contentinfo")
      await expect(
        footer.getByText("Prepared by", { exact: true })
      ).toBeVisible()
      await expect(footer.getByText("Generated")).toBeVisible()
      await expect(footer.getByText(/Listings?/).first()).toBeVisible()

      // Switching period lands on the figures (#main), not the top.
      const ninety = header.getByRole("link", { name: "Last 90 days" })
      await expect(ninety).toHaveAttribute("href", "?period=90d#main")
      await ninety.click()
      await expect(shared).toHaveURL(/\?period=90d#main$/)
      await expect(
        shared.getByRole("link", { name: "Last 90 days" })
      ).toHaveAttribute("aria-current", "page")
      await expect(shared.getByRole("main")).toBeInViewport()
    } finally {
      await reader.close()
    }

    // Tidy up: revoke the link this test made, from the same sheet.
    await dialog
      .getByRole("button", { name: /^Revoke the link/ })
      .first()
      .click()
    await page
      .getByRole("alertdialog", { name: "Revoke this link?" })
      .getByRole("button", { name: "Revoke link" })
      .click()
    await expect(page.getByText("Link revoked")).toBeVisible()
  })

  test("a revoked link is the same plain 'isn't available' page", async ({
    browser,
    page,
    baseURL,
  }) => {
    const state = await readJourneyState()
    const dialog = await openShareSheet(page, state.clientId)
    await dialog
      .locator('[data-slot="dialog-footer"]')
      .getByRole("button", { name: "Create link" })
      .click()
    const path = new URL(
      await dialog.getByRole("textbox", { name: "Report link" }).inputValue()
    ).pathname
    await dialog
      .getByRole("button", { name: /^Revoke the link/ })
      .first()
      .click()
    await page
      .getByRole("alertdialog", { name: "Revoke this link?" })
      .getByRole("button", { name: "Revoke link" })
      .click()
    await expect(page.getByText("Link revoked")).toBeVisible()

    const reader = await browser.newContext({ baseURL })
    try {
      const shared = await reader.newPage()
      await shared.goto(path)
      await expect(
        shared.getByRole("heading", {
          level: 1,
          name: "This report link isn’t available",
        })
      ).toBeVisible()
      await expect(shared.getByRole("link")).toHaveCount(0)
    } finally {
      await reader.close()
    }
  })
})
