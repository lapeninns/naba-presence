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
    for (const column of ["Listing", "Client", "Health", "Waiting"]) {
      await expect(
        page.getByRole("columnheader", { name: column, exact: true })
      ).toBeVisible()
    }
    const row = page
      .getByRole("row")
      .filter({ hasText: state.directReview.locationName })
    await expect(row).toBeVisible()
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
    // The health strip and one card per area, each with its own way in.
    const health = page.getByRole("region", { name: "Health" })
    await expect(health.getByText("Google connection")).toBeVisible()
    await expect(
      health.getByText("Verification", { exact: true })
    ).toBeVisible()
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
      .getByRole("link", { name: "Check Opening hours", exact: true })
      .click()
    await expect(page).toHaveURL(
      new RegExp(`/listings/${state.primaryLocationId}/hours$`)
    )
    await expect(
      page.getByRole("heading", { name: "Opening hours", level: 1 })
    ).toBeVisible()
    await expect(
      page
        .getByRole("navigation", { name: "Listing areas" })
        .getByRole("link", { name: "Overview" })
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
        await page.waitForLoadState("networkidle")
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
    await expect(page.getByRole("heading", { name: "Add photos" })).toBeVisible()
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
    // Five roles, each waiting for the profile editor's paced Google reads
    // before networkidle, so the default budget is too tight.
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
      await page.goto(`/listings/${state.primaryLocationId}/profile`)
      await page.waitForLoadState("networkidle")
      await expect(
        page.getByRole("heading", { name: "Identity" })
      ).toBeVisible()
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
    await page.goto(`/listings/${state.primaryLocationId}/profile`)
    const name = page.getByRole("textbox", { name: "Business name" })
    await expect(name).toBeVisible()
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
    await page.waitForLoadState("networkidle")
    await page
      .getByRole("textbox", { name: "Link", exact: true })
      .fill("https://book.e2e/reserve")
    // A link change is reviewed, approved, then sent as a separate step.
    await page
      .getByRole("button", { name: "Review action link", exact: true })
      .click()
    const sheet = page.getByRole("dialog", {
      name: /^(Review action link change|Saved action link outcome)$/,
    })
    await sheet
      .getByRole("button", { name: "Approve action link change", exact: true })
      .click()
    const send = sheet.getByRole("button", {
      name: "Send approved action link change",
      exact: true,
    })
    await expect(send).toBeDisabled()
    await sheet
      .getByRole("checkbox", {
        name: "Send this exact approved action link change to Google.",
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
    await page.goto(`/listings/${state.primaryLocationId}/profile`)
    // Google's half of the listing fans out across several of its APIs, paced
    // by the per-connection rate limiter, so the fields it owns arrive after
    // the NabaPresence copy the editor opens on.
    await page.waitForLoadState("networkidle")
    const storeCode = page.getByRole("textbox", { name: "Store code" })
    await expect(storeCode).toBeVisible()
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
    await page.waitForLoadState("networkidle")
    const lodging = page.getByRole("region", {
      name: "Lodging details",
      exact: true,
    })
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
    // a bug — so wait for the network to settle before asserting content
    // rather than racing the default 5s expect timeout (same pattern as the
    // clean-load loop above).
    await page.waitForLoadState("networkidle")
    // The area page's h1 is "Verification"; the console's first section
    // heading is the one that proves Google's answer loaded.
    await expect(
      page.getByRole("heading", {
        name: "How Google sees this listing",
        level: 2,
      })
    ).toBeVisible()
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
    // See the same note in the publish journey above: Administration's 7-way
    // Google fan-out is genuinely slower than the default 5s expect timeout
    // budgets for.
    await page.waitForLoadState("networkidle")
    await expect(
      page.getByRole("heading", { name: "Danger zone" })
    ).toBeVisible()

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
})
