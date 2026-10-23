import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, test } from "@playwright/test"
import { mediaQuery } from "@/lib/ui/breakpoints"

import {
  GOOGLE_READS_TIMEOUT,
  pageSettled,
  profileLoadedFromGoogle,
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
// The listing's areas, one focused route each, plus the overview. Every
// page's h1 is the area's label; the overview's is the listing's name.
const AREAS = [
  { segment: "profile", label: "Business profile" },
  { segment: "hours", label: "Opening hours" },
  { segment: "booking", label: "Booking links" },
  { segment: "photos", label: "Photos" },
  { segment: "posts", label: "Posts" },
  { segment: "menu", label: "Food menu" },
  { segment: "suggestions", label: "Suggested updates" },
  // Owner-scoped entries: both gate their own GET on canEditCanonical and are
  // hidden for non-owner/admin (see the console role walk below), so their
  // clean-load + axe iterations only render under the owner cookie this whole
  // loop already uses.
  { segment: "people", label: "People with access" },
  { segment: "verification", label: "Verification" },
] as const

async function applyCookie(
  page: Page,
  baseURL: string | undefined,
  cookie: string
) {
  const [name, value] = cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
}

test.describe("listings", () => {
  test("the board lists every listing and the overview shows its areas", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto("/listings")
    await expect(
      page.getByRole("heading", { name: "Listings", level: 1 })
    ).toBeVisible()
    const table = page.getByRole("table", {
      name: "Listings, with their Google health and what is waiting on each",
    })
    await expect(table).toBeVisible()
    const row = page
      .getByRole("row")
      .filter({ hasText: state.directReview.locationName })
    await expect(row).toBeVisible()
    // The board is a table only while its own container is 48rem wide (a
    // container query, so 375 and 768 both get record cards). There the
    // header row steps aside and each card's title line, the listing's name,
    // is what stands in for the Listing column.
    const cards = await table.evaluate(
      (element) => (element.parentElement?.clientWidth ?? 0) < 768
    )
    const columns = ["Listing", "Client", "Health", "Waiting"]
    for (const column of columns) {
      const header = page.getByRole("columnheader", {
        name: column,
        exact: true,
      })
      if (cards) await expect(header).toBeHidden()
      else await expect(header).toBeVisible()
    }
    if (cards) {
      const title = row.getByRole("link", {
        name: state.directReview.locationName,
      })
      await expect(title).toBeVisible()
      // The title line is the card's first line: nothing in the row sits
      // above the listing's name.
      const titleBox = await title.boundingBox()
      const rowBox = await row.boundingBox()
      expect(titleBox && rowBox).toBeTruthy()
      expect(titleBox!.y - rowBox!.y).toBeLessThan(titleBox!.height)
    }
    // The Waiting column is the DB-only summary: it settles without Google.
    await expect(
      row.getByText(/Nothing waiting|to publish|Google change/)
    ).toBeVisible()
    await row
      .getByRole("link", { name: state.directReview.locationName })
      .click()

    await expect(page).toHaveURL(
      new RegExp(`/listings/${state.primaryLocationId}$`)
    )
    await expect(
      page.getByRole("heading", {
        name: state.directReview.locationName,
        level: 1,
      })
    ).toBeVisible()
    // Two rows under the areas (verification and sync are each area card's
    // own status), and one card per area, each with its own way in.
    const google = page.getByRole("region", { name: "Google", exact: true })
    await expect(google.getByText("Google connection")).toBeVisible()
    await expect(google.getByText("Last published")).toBeVisible()
    await expect(google.getByText("Verification", { exact: true })).toHaveCount(
      0
    )
    const areas = page.getByRole("region", { name: "Areas" })
    for (const area of [
      "Business profile",
      "Opening hours",
      "Booking links",
      "Photos",
      "Posts",
      "Food menu",
      "People with access",
    ]) {
      await expect(
        areas.getByRole("heading", { name: area, level: 3 })
      ).toBeVisible()
    }
    await expect(areas.getByRole("link", { name: "Performance" })).toHaveCount(
      0
    )

    // Opening an area is a focused page with the way back in its header.
    await areas
      .getByRole("link", { name: "Open Opening hours", exact: true })
      .click()
    await expect(page).toHaveURL(
      new RegExp(`/listings/${state.primaryLocationId}/hours$`)
    )
    await expect(
      page.getByRole("heading", { name: "Opening hours", level: 1 })
    ).toBeVisible()
    // From lg the way back is the "Listing areas" tab row. Below lg that row
    // steps aside and the page title is the area switcher: its words open
    // the same list of areas as a menu (an action sheet on a phone).
    const overviewHref = new RegExp(`/listings/${state.primaryLocationId}$`)
    const tabs = page.getByRole("navigation", { name: "Listing areas" })
    const wide = await page.evaluate(
      (query) => window.matchMedia(query).matches,
      mediaQuery("lg")
    )
    let overview = tabs.getByRole("link", { name: "Overview" })
    if (!wide) {
      await expect(tabs).toBeHidden()
      await page
        .getByRole("heading", { name: "Opening hours", level: 1 })
        .getByRole("button", { name: "Opening hours", exact: true })
        .click()
      await expect(
        page.getByRole("menuitem", { name: /^Opening hours/ })
      ).toHaveAttribute("aria-current", "page")
      overview = page.getByRole("menuitem", { name: "Overview", exact: true })
    }
    await expect(overview).toBeVisible()
    await expect(overview).toHaveAttribute("href", overviewHref)
    // Either way, it goes back to the listing's overview.
    await overview.click()
    await expect(page).toHaveURL(overviewHref)
    await expect(
      page.getByRole("heading", {
        name: state.directReview.locationName,
        level: 1,
      })
    ).toBeVisible()
  })

  for (const theme of ["light", "dark"] as const) {
    for (const tab of [{ segment: "", label: "Overview" }, ...AREAS]) {
      test(`${tab.label} loads clean (${theme})`, async ({ baseURL, page }) => {
        const consoleErrors: string[] = []
        const pageErrors: string[] = []
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push(message.text())
        })
        page.on("pageerror", (error) => pageErrors.push(error.message))
        const requests = trackRequests(page)
        await page.emulateMedia({ colorScheme: theme })
        const state = await readJourneyState()
        await applyCookie(page, baseURL, state.cookie)
        await page.goto(
          `/listings/${state.primaryLocationId}${tab.segment ? `/${tab.segment}` : ""}`
        )
        await expect(
          page.getByRole("heading", {
            name: tab.segment ? tab.label : state.directReview.locationName,
            level: 1,
          })
        ).toBeVisible()
        // Listings, not Clients, owns every listing page in the sidebar.
        await expect(
          page
            .getByRole("navigation", { name: "Primary" })
            .getByRole("link", { name: "Listings", exact: true })
        ).toHaveAttribute("aria-current", "page")
        // Google's paced reads can keep a page loading past the heading.
        await pageSettled(page)
        await requests.idle()
        const label = tab.label
        expect(consoleErrors, `${theme} ${label} console`).toEqual([])
        expect(pageErrors, `${theme} ${label} pageerror`).toEqual([])
        const wcag = await new AxeBuilder({ page })
          .withTags(WCAG_TAGS)
          .analyze()
        expect(wcag.violations, `${theme} ${label} wcag`).toEqual([])
        const best = await new AxeBuilder({ page })
          .withTags(["best-practice"])
          .analyze()
        expect(
          best.violations.filter((v) => STRUCTURE_RULES.includes(v.id)),
          `${theme} ${label} structure`
        ).toEqual([])
      })
    }
  }

  test("photos tab exposes the add-media controls (extracted from gbp-management-tabs)", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto(`/listings/${state.primaryLocationId}/photos`)
    await page.getByRole("button", { name: "Add photos" }).click()
    await expect(
      page.getByRole("heading", { name: "Add photos" })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Choose from library" })
    ).toBeVisible()
    await expect(page.getByLabel("Direct file upload")).toHaveAttribute(
      "accept",
      "image/jpeg,image/png"
    )
    await expect(
      page.getByRole("button", { name: "Upload photos" })
    ).toBeDisabled()
  })

  test("permission walk: owner/admin can edit canonical; member/viewer cannot", async ({
    baseURL,
    browser,
  }) => {
    const state = await readJourneyState()
    const cases: Array<[string, boolean]> = [
      [state.cookie, true],
      [state.adminCookie, true],
      [state.memberAssignedCookie, false],
      [state.memberUnassignedCookie, false],
      [state.viewerCookie, false],
    ]
    for (const [cookie, canEdit] of cases) {
      const context = await browser.newContext()
      const page = await context.newPage()
      await applyCookie(page, baseURL, cookie)
      await page.goto(`/listings/${state.primaryLocationId}/profile`)
      const review = page.getByRole("button", { name: "Review changes" })
      const gate = page.getByText(
        "Only owners and admins can edit this location."
      )
      if (canEdit) {
        // Nothing tells an owner they may not edit. A clean editor draws no
        // footer bar; the owner's first edit brings "Review changes" in.
        await expect(gate).toHaveCount(0)
        const name = page.getByRole("textbox", { name: "Business name" })
        await expect(name).toBeEnabled()
        await expect(review).toHaveCount(0)
        await name.fill(`${await name.inputValue()} edited`)
        await expect(review).toBeVisible()
      } else {
        // A role that can't edit gets the one view-only bar: it says why and
        // offers no actions, rather than a row of disabled buttons.
        await expect(page.getByText(/View-only access\./)).toBeVisible()
        await expect(review).toHaveCount(0)
        await expect(
          page.getByRole("button", { name: "Save here" })
        ).toHaveCount(0)
        await expect(gate.first()).toBeVisible()
        await expect(
          page.getByRole("textbox", { name: "Business name" })
        ).toBeDisabled()
      }
      await context.close()
    }
  })

  test("console role walk: People/Verification hidden for member/viewer; the business profile stays read-only for everyone", async ({
    baseURL,
    browser,
  }) => {
    // Five roles, each waiting for the profile editor's paced Google reads,
    // so the default budget is too tight.
    test.setTimeout(120_000)
    const state = await readJourneyState()
    const cases: Array<[string, boolean]> = [
      [state.cookie, true],
      [state.adminCookie, true],
      [state.memberAssignedCookie, false],
      [state.memberUnassignedCookie, false],
      [state.viewerCookie, false],
    ]
    for (const [cookie, canManage] of cases) {
      const context = await browser.newContext()
      const page = await context.newPage()
      const consoleErrors: string[] = []
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text())
      })
      await applyCookie(page, baseURL, cookie)

      // The industry sections gate their own GET on canEditCanonical before it
      // ever fires, so a member loading the profile must never surface a
      // request (403 or otherwise) for them.
      const industryResponses: number[] = []
      page.on("response", (response) => {
        if (
          new URL(response.url()).pathname ===
          `/api/locations/${state.primaryLocationId}/industry`
        ) {
          industryResponses.push(response.status())
        }
      })

      // The business profile is read-open for every role; only editing is
      // gated, never the whole area.
      const requests = trackRequests(page)
      await page.goto(`/listings/${state.primaryLocationId}/profile`)
      await expect(page.getByRole("heading", { name: "Identity" })).toBeVisible(
        { timeout: GOOGLE_READS_TIMEOUT }
      )
      // Every read the profile makes is answered before the negative
      // assertion below, which is about a request that must never fire.
      await pageSettled(page)
      await requests.idle()
      const name = page.getByRole("textbox", { name: "Business name" })
      if (canManage) {
        await expect(name).toBeEnabled()
      } else {
        await expect(name).toBeDisabled()
        await expect(
          page
            .getByText("Only owners and admins can edit this location.")
            .first()
        ).toBeVisible()
        expect(
          industryResponses,
          `${cookie} industry GET must never fire for a non-manager`
        ).toEqual([])
      }

      // The overview offers the consoles only to owners and admins.
      await page.goto(`/listings/${state.primaryLocationId}`)
      const areas = page.getByRole("region", { name: "Areas" })
      await expect(
        areas.getByRole("heading", { name: "Photos", level: 3 })
      ).toBeVisible()
      if (canManage) {
        await expect(
          areas.getByRole("heading", { name: "People with access", level: 3 })
        ).toBeVisible()
        await expect(
          areas.getByRole("heading", { name: "Verification", level: 3 })
        ).toBeVisible()
      } else {
        await expect(
          areas.getByRole("heading", { name: "People with access", level: 3 })
        ).toHaveCount(0)

        const administrationResponses: number[] = []
        page.on("response", (response) => {
          if (
            new URL(response.url()).pathname ===
            `/api/locations/${state.primaryLocationId}/administration`
          ) {
            administrationResponses.push(response.status())
          }
        })
        await page.goto(`/listings/${state.primaryLocationId}/people`)
        await expect(
          page.getByText("This section is available to owners and admins")
        ).toBeVisible()
        expect(
          administrationResponses,
          `${cookie} administration GET must never fire for a non-manager`
        ).toEqual([])
      }

      expect(consoleErrors, `${cookie} console errors`).toEqual([])
      await context.close()
    }
  })

  test("publish journey: an owner edits the business name, reviews the diff, then publishes", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    const requests = trackRequests(page)
    await page.goto(`/listings/${state.primaryLocationId}/profile`)
    const name = page.getByRole("textbox", { name: "Business name" })
    await expect(name).toBeVisible()
    // Google's half of the profile arrives after the NabaPresence copy, and
    // the publish below carries the hash of everything Google answered: an
    // edit made before those reads finish is followed away by the editor
    // when they land, so "Review changes" never appears. Edit once they have.
    await profileLoadedFromGoogle(page)
    await requests.idle()
    await name.fill("Riverside Rooms & Spa")

    // Nothing reaches Google until the diff has been seen: the review sheet
    // names the field and what it will become.
    await page.getByRole("button", { name: "Review changes" }).click()
    const sheet = page.getByRole("dialog")
    await expect(sheet.getByText("Business name")).toBeVisible()
    await expect(sheet.getByText("Riverside Rooms & Spa")).toBeVisible()

    const saved = page.waitForResponse(
      (r) =>
        r.request().method() === "PUT" &&
        new URL(r.url()).pathname ===
          `/api/locations/${state.primaryLocationId}/profile`
    )
    await sheet.getByRole("button", { name: "Publish to Google" }).click()
    expect((await saved).status()).toBe(200)
  })

  test("publish failure: Review & publish says it once, names the next action and keeps the code behind support details", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto(`/listings/${state.primaryLocationId}/profile`)
    const name = page.getByRole("textbox", { name: "Business name" })
    await expect(name).toBeVisible()
    // Google's half of the profile arrives after the NabaPresence copy.
    await profileLoadedFromGoogle(page)
    await name.fill("Riverside Rooms & Suites")
    // Save the change in NabaPresence only, so Review & publish has it waiting.
    // "Save here" is a secondary of the editor's bar: inline from `md`, and on
    // a phone folded into the bar's "More actions" menu, so the bar stays one
    // row. Reach it the way that width does.
    const bar = page.getByRole("region", { name: "Editor actions" })
    const saveHere = bar.getByRole("button", { name: "Save here", exact: true })
    const saved = page.waitForResponse(
      (r) =>
        r.request().method() === "PUT" &&
        new URL(r.url()).pathname ===
          `/api/locations/${state.primaryLocationId}/profile`
    )
    if (page.viewportSize()!.width < 768) {
      await expect(saveHere).toBeHidden()
      await bar.getByRole("button", { name: "More actions" }).click()
      await page.getByRole("menuitem", { name: "Save here" }).click()
    } else {
      await saveHere.click()
    }
    expect((await saved).status()).toBe(200)

    // Review & publish sends the profile step as a POST operation (the save
    // above was the PUT), so fail that one.
    await page.route(
      `**/api/locations/${state.primaryLocationId}/profile`,
      (route) =>
        route.request().method() === "POST"
          ? route.fulfill({
              status: 500,
              contentType: "application/json",
              body: JSON.stringify({
                error: "NOT_FOUND",
                message: "Not found",
              }),
            })
          : route.fallback()
    )
    await page.goto(`/listings/${state.primaryLocationId}/changes`)
    // An earlier test may already have moved Google's name on, which asks the
    // owner to confirm the replace before the button enables.
    const publish = page.getByRole("button", {
      name: /^Publish \d+ areas? to Google$/,
    })
    await expect(publish).toBeVisible()
    const confirm = page.getByRole("checkbox", { name: /want to replace it/ })
    await expect(async () => {
      if ((await confirm.count()) > 0 && !(await confirm.isChecked())) {
        await page.getByText(/want to replace it/).click()
      }
      await expect(publish).toBeEnabled({ timeout: 1_000 })
    }).toPass({ timeout: 10_000 })
    await publish.click()

    // One banner carries the next action; focus lands on it.
    const banner = page.getByText(/Publishing stopped at/).first()
    await expect(banner).toBeVisible()
    await expect(
      page.getByText(
        /Retry publishing when you’re ready|Check Google, then retry publishing/
      )
    ).toBeVisible()
    // The step's own Retry is gone: the one action is the main button.
    await expect(
      page.getByRole("list", { name: "Publish results" }).getByRole("button", {
        name: "Retry",
      })
    ).toHaveCount(0)
    // The toast is six words or fewer and the code stays behind the details.
    await expect(
      page.getByText("Publishing stopped. See the steps.")
    ).toBeVisible()
    await expect(page.getByText("NOT_FOUND")).toBeHidden()
    await page.getByText("Details for support").first().click()
    await expect(page.getByText("NOT_FOUND").first()).toBeVisible()
  })

  test("read-only views: a member sees read rows, not greyed fields, and Review & publish does not send them off to edit", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.memberAssignedCookie)
    await page.goto(`/listings/${state.primaryLocationId}/profile`)
    await expect(page.getByText(/View-only access\./)).toBeVisible()
    // The field stays disabled but reads as plain text: the editor is a read
    // view, with no box and no greyed-out ink.
    const field = page.getByRole("textbox", { name: "Business name" })
    await expect(field).toBeDisabled()
    await expect(page.locator("[data-read-only]").first()).toBeVisible()
    await expect(field).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
    await expect(field).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)")

    await page.goto(`/listings/${state.primaryLocationId}/changes`)
    await expect(
      page.getByRole("heading", { name: "Review & publish", level: 1 })
    ).toBeVisible()
    await expect(page.getByText(/Edit an area and come back here/)).toHaveCount(
      0
    )
  })

  test("the retired Performance segment lands on Reports scoped to the location", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto(`/locations/${state.primaryLocationId}/performance`)
    await expect(page).toHaveURL(
      new RegExp(`/reports\\?locationId=${state.primaryLocationId}$`)
    )
    await expect(
      page.getByRole("heading", { name: "Reports", level: 1 })
    ).toBeVisible()
    await expect(
      page.getByText(`Reporting on ${state.directReview.locationName}`)
    ).toBeVisible()
    // The section headings are "Review activity" / "Visibility on Google";
    // "Reviews" itself is a StatTile label inside "Review activity", not a
    // heading (see components/performance/location-performance.tsx).
    await expect(
      page.getByRole("heading", { name: "Review activity" })
    ).toBeVisible()
    await expect(
      page.getByRole("heading", { name: "Visibility on Google" })
    ).toBeVisible()
  })

  test("booking create journey: an owner adds a booking link", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    // The retired /locations path forwards to the listing's booking area.
    await page.goto(`/locations/${state.primaryLocationId}/booking`)
    await expect(page).toHaveURL(
      new RegExp(`/listings/${state.primaryLocationId}/booking$`)
    )
    // Not getByLabel("Link"): the Booking type <Select>'s trigger carries
    // aria-label="Booking link type", which contains "Link" as a substring
    // and makes the plain label lookup ambiguous (strict-mode violation).
    // getByRole pins the accessible role too, so it resolves to the single
    // textbox unambiguously.
    const link = page.getByRole("textbox", { name: "Link", exact: true })
    await expect(link).toBeVisible({ timeout: GOOGLE_READS_TIMEOUT })
    await link.fill("https://book.e2e/reserve")
    // A link change is reviewed, approved, then sent as a separate step.
    await page
      .getByRole("button", { name: "Review booking link", exact: true })
      .click()
    const sheet = page.getByRole("dialog", {
      name: /^(Review booking link change|Saved booking link outcome)$/,
    })
    await sheet
      .getByRole("button", { name: "Approve booking link change", exact: true })
      .click()
    const send = sheet.getByRole("button", {
      name: "Send approved booking link change",
      exact: true,
    })
    await expect(send).toBeDisabled()
    await sheet
      .getByRole("checkbox", {
        name: "Send this exact approved booking link change to Google.",
      })
      .check()
    const sent = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname.startsWith(
          `/api/locations/${state.primaryLocationId}/place-action-reviews/`
        ) &&
        r.url().endsWith("/execute")
    )
    await send.click()
    expect((await sent).status()).toBe(200)
    await expect(
      sheet.getByText("Accepted by Google", { exact: true })
    ).toBeVisible()
    await expect(
      sheet.getByText("Independently confirmed", { exact: true })
    ).toBeVisible()
  })

  test("listing publish journey: a Google-only field goes out through the same review sheet", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    const requests = trackRequests(page)
    await page.goto(`/listings/${state.primaryLocationId}/profile`)
    // Google's half of the listing fans out across several of its APIs, paced
    // by the per-connection rate limiter, so the fields it owns arrive after
    // the NabaPresence copy the editor opens on. The store code says the
    // profile's half is in; the publish below carries the hash of everything
    // Google answered, so wait until every one of those reads has finished
    // (what networkidle used to give this test) before editing.
    const storeCode = page.getByRole("textbox", { name: "Store code" })
    await expect(storeCode).toBeVisible({ timeout: GOOGLE_READS_TIMEOUT })
    await requests.idle()
    await storeCode.fill("RIVERSIDE-2")
    await page.getByRole("button", { name: "Review changes" }).click()
    // Hash-pinned: the PATCH carries `expectedGoogleHash` from the page's own
    // load, and the route 409s (business_information_stale) if Google's
    // current state no longer hashes to match — a live optimistic-concurrency
    // guard, not a mocked one.
    const published = page.waitForResponse(
      (r) =>
        r.request().method() === "PATCH" &&
        new URL(r.url()).pathname ===
          `/api/locations/${state.primaryLocationId}/business-information`
    )
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Publish to Google" })
      .click()
    expect((await published).status()).toBe(200)
  })

  test("industry publish journey: an owner updates and publishes the lodging check-in time", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    // Lodging is a section of the business profile now, shown only for a
    // listing Google holds lodging data for.
    await page.goto(`/listings/${state.primaryLocationId}/profile`)
    // See the note in the listing publish journey: the industry sections load
    // after the editor's first paint.
    const lodging = page.getByRole("region", {
      name: "Lodging details",
      exact: true,
    })
    await expect(lodging).toBeVisible({ timeout: GOOGLE_READS_TIMEOUT })
    await lodging
      .getByRole("searchbox", { name: "Find a lodging detail" })
      .fill("Checkin time")
    const checkin = lodging.getByLabel("Check-in time", { exact: true })
    await expect(checkin).toBeVisible()
    await checkin.fill("16:00")
    // Lodging changes are reviewed, approved, then sent as a separate step.
    await page
      .getByRole("button", { name: "Review lodging changes", exact: true })
      .click()
    const dialog = page.getByRole("dialog", {
      name: /^(Review changes|Saved lodging outcome)$/,
    })
    await dialog
      .getByRole("button", { name: "Approve lodging changes", exact: true })
      .click()
    const send = dialog.getByRole("button", {
      name: "Send approved lodging changes",
      exact: true,
    })
    await expect(send).toBeDisabled()
    await dialog
      .getByRole("checkbox", {
        name: "Send these exact approved lodging changes to Google.",
      })
      .check()
    await send.click()
    await expect(
      dialog.getByText("Accepted by Google", { exact: true })
    ).toBeVisible()
    await expect(
      dialog.getByText("Independently confirmed", { exact: true })
    ).toBeVisible()
  })

  test("verification journey: an owner starts a Google verification (non-destructive)", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto(`/listings/${state.primaryLocationId}/verification`)
    // Administration fans out 7 Google calls, each paced ~500ms apart on the
    // shared connection (lib/server/google.ts's per-connection rate limiter)
    // — a real, deliberate characteristic of the protected server code, not
    // a bug — so the assertion that proves the answer arrived waits for it
    // (GOOGLE_READS_TIMEOUT) rather than racing the default 5s expect timeout.
    // The area page's h1 is "Verification"; the console's first section
    // heading is the one that proves Google's answer loaded.
    await expect(
      page.getByRole("heading", {
        name: "How Google sees this listing",
        level: 2,
      })
    ).toBeVisible({ timeout: GOOGLE_READS_TIMEOUT })
    // The stub listing is verified with nothing pending, so the answer leads
    // and the tools sit behind one disclosure.
    await expect(
      page.getByText("Verified. Google confirms you manage this listing.")
    ).toBeVisible()
    await page.getByText("Verification tools", { exact: true }).click()
    // Starting verification is reviewed, approved, then sent separately.
    const panel = page.locator('section[aria-labelledby="verification-start"]')
    await panel.getByRole("button", { name: "Check available methods" }).click()
    await panel.getByRole("radio").check()
    await panel.getByLabel("Email username").fill("operations")
    await panel
      .getByRole("button", { name: "Review verification request" })
      .click()
    await panel
      .getByRole("button", { name: "Approve verification request" })
      .click()
    const send = panel.getByRole("button", {
      name: "Send approved verification request",
    })
    await expect(send).toBeDisabled()
    await panel
      .getByRole("checkbox", {
        name: "Send this exact approved verification request to Google.",
      })
      .check()
    await expect(send).toBeEnabled()
    // Stop before the send: the journey listing already has merchant
    // standing on Google, so the server refuses the write
    // (verification_not_required). verification-start-backend.spec.ts sends
    // and confirms each method on an unverified fixture.
  })

  test("access danger zone: a reviewed deletion stays unsendable until approved, named and consented", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto(`/listings/${state.primaryLocationId}/people`)
    // See the same note in the verification journey above: Administration's
    // 7-way Google fan-out is genuinely slower than the default 5s expect
    // timeout budgets for.
    await expect(
      page.getByRole("heading", { name: "Danger zone" })
    ).toBeVisible({ timeout: GOOGLE_READS_TIMEOUT })

    await page.getByRole("button", { name: "Delete this location" }).click()
    await page
      .getByRole("button", { name: "Prepare deletion review", exact: true })
      .click()
    const review = page.locator(
      'section[aria-labelledby="lifecycle-review-title"]'
    )
    await review
      .getByRole("button", { name: "Approve lifecycle request" })
      .click()
    const send = review.getByRole("button", { name: "Send approved deletion" })
    await expect(send).toBeDisabled()
    await review
      .getByLabel("Type the listing name:", { exact: false })
      .fill(state.directReview.locationName)
    await expect(send).toBeDisabled()
    await review
      .getByRole("checkbox", {
        name: "Send this exact approved lifecycle request to Google.",
      })
      .check()
    await expect(send).toBeEnabled()
    // The shared journey tenant keeps its listing: stop short of the send,
    // which lifecycle-backend.spec.ts covers end to end on its own tenant.
    await review
      .getByRole("button", { name: "Keep this location unchanged" })
      .click()
    await expect(review).toHaveCount(0)
  })

  test("profile section headings at 390: only Identity's is screen-reader text, every other has a normal box (incl. Lodging)", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/listings/${state.primaryLocationId}/profile`)
    // The industry sections load after the editor's first paint.
    await expect(
      page.getByRole("heading", { name: "Lodging", exact: true })
    ).toBeAttached({ timeout: GOOGLE_READS_TIMEOUT })
    // A rendered box, not toBeVisible: an sr-only heading is a 1 px clipped
    // box and passes that.
    const headings = await page
      .locator('[data-slot="settings-group-label"]')
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect()
          const style = getComputedStyle(node)
          return {
            text: node.textContent?.trim() ?? "",
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            clipped: style.clip !== "auto" || style.clipPath !== "none",
          }
        })
      )
    const byName = (name: string) => headings.find((item) => item.text === name)
    expect(byName("Identity")).toMatchObject({ width: 1, height: 1 })
    for (const name of ["Lodging", "Categories"]) {
      const heading = byName(name)
      expect(heading, `${name} heading is on the page`).toBeDefined()
      expect(heading!.width, `${name} heading width`).toBeGreaterThan(30)
      expect(heading!.height, `${name} heading height`).toBeGreaterThan(10)
      expect(heading!.clipped, `${name} heading clipped`).toBe(false)
    }
    // And no heading other than Identity's is hidden.
    expect(
      headings.filter((item) => item.width <= 1 && item.height <= 1)
    ).toEqual([expect.objectContaining({ text: "Identity" })])

    // From desk Identity's heading is drawn again.
    await page.setViewportSize({ width: 1280, height: 800 })
    const identity = page.locator("#section-identity-heading")
    await expect
      .poll(async () => (await identity.boundingBox())?.height ?? 0)
      .toBeGreaterThan(10)
  })
})

test.describe("profile section nav focus at 390", () => {
  // The section nav's tab moves focus to the section's heading. Identity's
  // heading is screen-reader text on a phone (a 1 px clipped box, which
  // draws no focus ring), so it must be drawn while it holds keyboard focus.
  test("Enter on the Identity tab leaves keyboard focus on a drawn, ringed heading; a tap leaves the quiet heading", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/listings/${state.primaryLocationId}/profile`)
    await profileLoadedFromGoogle(page)
    const nav = page.getByRole("navigation", { name: "Profile sections" })
    const identityTab = nav.getByRole("link", { name: "Identity" })
    const heading = page.locator("#section-identity-heading")
    const box = () =>
      heading.evaluate((node) => {
        const rect = node.getBoundingClientRect()
        const style = getComputedStyle(node)
        return {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          clipped: style.clip !== "auto" || style.clipPath !== "none",
          top: Math.round(rect.top),
          // A ring that draws: a box-shadow with a colour that is not
          // transparent (the focus-visible ring), not merely "not none".
          ring:
            style.boxShadow !== "none" &&
            /rgba?\((?!\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\))|oklch|oklab|color\(|lab\(|lch\(/.test(
              style.boxShadow
            ),
        }
      })

    // Negative control: before the jump the heading is the quiet 1 x 1 box,
    // which is what the rendered-box checks below would catch if the
    // focus-visible rule were missing.
    expect(await box()).toMatchObject({ width: 1, height: 1, clipped: true })

    // A tap is not keyboard focus: the heading takes focus but stays quiet,
    // so a pointer user sees no heading pop in under the tabs.
    await identityTab.click()
    await expect(heading).toBeFocused()
    expect(await box()).toMatchObject({ width: 1, height: 1, clipped: true })
    await page.locator("body").click({ position: { x: 5, y: 400 } })
    await expect(heading).not.toBeFocused()

    // The keyboard path: the tab is focused, then Enter activates it.
    await identityTab.focus()
    await page.keyboard.press("Enter")
    await expect(heading).toBeFocused()
    await expect
      .poll(async () => (await box()).width, {
        message: "focused heading width",
      })
      .toBeGreaterThan(30)
    expect(await box()).toMatchObject({ clipped: false, ring: true })
    expect((await box()).height).toBeGreaterThan(10)
    // And it sits clear of the sticky tab strip, not scrolled under it.
    const strip = await nav.boundingBox()
    expect((await box()).top).toBeGreaterThanOrEqual(
      Math.round(strip!.y + strip!.height)
    )

    // Leaving it puts the quiet box back.
    await page.keyboard.press("Tab")
    await expect(heading).not.toBeFocused()
    expect(await box()).toMatchObject({ width: 1, height: 1, clipped: true })
  })
})

// LST-16: on desk (768 px and up, fine pointer) the card group once stretched
// every child of a row to the card's width, so each day's switch took the row
// and the day name and times got no width. A day is its row and its switch
// side by side at both sizes: the row has the day's name and hours and real
// width, the switch stays its own size and sits to the right of it.
for (const viewport of [
  { width: 1280, height: 800 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
]) {
  test(`the hours rows keep the day name and times beside the switch at ${viewport.width}px`, async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.setViewportSize(viewport)
    await page.goto(`/listings/${state.primaryLocationId}/hours`)
    await expect(
      page.getByRole("heading", { name: "Opening hours", level: 1 })
    ).toBeVisible()
    const toggle = page.getByRole("switch", { name: "Monday open" })
    const day = toggle.locator("xpath=ancestor::li[1]")
    await expect(day).toBeVisible()
    const row = day.getByRole("button", { name: /^Monday/ })
    await expect(row).toContainText("Monday")
    await expect(row).toContainText(/Closed|\d{2}:\d{2}/)
    const rowBox = (await row.boundingBox())!
    const toggleBox = (await toggle.boundingBox())!
    // The name and times keep most of the line; the switch stays switch-sized.
    expect(rowBox.width).toBeGreaterThan(viewport.width / 3)
    expect(toggleBox.width).toBeLessThan(80)
    expect(toggleBox.x).toBeGreaterThanOrEqual(rowBox.x + rowBox.width - 1)
    // One line each, level with the other: neither wrapped under the other.
    expect(
      Math.abs(
        rowBox.y + rowBox.height / 2 - (toggleBox.y + toggleBox.height / 2)
      )
    ).toBeLessThan(rowBox.height / 2)
    // Every weekday keeps its name, none collapsed to a bare switch.
    for (const name of [
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]) {
      await expect(
        page.getByRole("button", { name: new RegExp(`^${name}`) }).first()
      ).toBeVisible()
      expect(
        (await page
          .getByRole("button", { name: new RegExp(`^${name}`) })
          .first()
          .boundingBox())!.width
      ).toBeGreaterThan(viewport.width / 3)
    }
  })
}

// #195 (Listings peer review note A) and GF-7: a document load of a
// streamed listing tab with the device clock ahead of the server. The tab's
// stamped payload hydrates under the layout's session: the editor asks
// Google nothing and React accepts the server's HTML. 60 s puts the session
// past its 30 s staleTime by an unaligned clock; 6 minutes the hours past
// their 5.
for (const skew of [60_000, 360_000]) {
  test(`the hours tab loads with the device clock ${skew / 1000} s ahead: no hours GET, no #418`, async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.addInitScript((skew) => {
      const RealDate = Date
      // Date() and new Date() read the skewed clock; Date(x), parse, UTC
      // and instanceof behave as ever.
      globalThis.Date = new Proxy(RealDate, {
        construct: (target, args) =>
          args.length === 0
            ? new target(target.now() + skew)
            : new target(...(args as [string])),
        apply: () => new RealDate(RealDate.now() + skew).toString(),
        get: (target, key) =>
          key === "now" ? () => target.now() + skew : Reflect.get(target, key),
      })
      // The device's wall clock dates the navigation too.
      const origin = performance.timeOrigin + skew
      Object.defineProperty(performance, "timeOrigin", { get: () => origin })
    }, skew)
    const hoursReads: string[] = []
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname ===
        `/api/locations/${state.primaryLocationId}/hours`
      )
        hoursReads.push(request.method())
    })
    const problems: string[] = []
    const requests = trackRequests(page)
    page.on("pageerror", (error) => problems.push(error.message))
    page.on("console", (message) => {
      if (message.type() === "error" && /#418|hydrat/i.test(message.text()))
        problems.push(message.text())
    })

    await page.goto(`/listings/${state.primaryLocationId}/hours`)
    // The page's clock is the skewed one.
    const ahead = (await page.evaluate(() => Date.now())) - Date.now()
    expect(ahead).toBeGreaterThan(skew - 5_000)
    expect(ahead).toBeLessThan(skew + 5_000)
    await expect(
      page.getByRole("heading", { name: "Opening hours", level: 1 })
    ).toBeVisible()
    // The editor itself, from the streamed read: not the tab's pending line.
    await expect(
      page.getByRole("switch", { name: "Monday open" })
    ).toBeVisible()
    // Every request answered: only then is "no hours read" a finding.
    await requests.idle()
    expect(hoursReads).toEqual([])
    expect(problems).toEqual([])
  })
}
