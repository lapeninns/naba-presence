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
// The three jobs and their routes. The Listing is one scroll (business
// profile, hours, booking, suggested updates) so it is one route; Content
// and Access keep a route per view.
const ROUTES = [
  { segment: "", job: "Listing", view: undefined },
  { segment: "photos", job: "Content", view: "Photos" },
  { segment: "posts", job: "Content", view: "Posts" },
  { segment: "menu", job: "Content", view: "Menu" },
  // Owner-scoped entries: both gate their own GET on canEditCanonical and are
  // hidden for non-owner/admin (see the console role walk below), so their
  // clean-load + axe iterations only render under the owner cookie this whole
  // loop already uses.
  { segment: "access", job: "Access", view: "People" },
  { segment: "verification", job: "Access", view: "Verification" },
] as const

async function applyCookie(
  page: Page,
  baseURL: string | undefined,
  cookie: string
) {
  const [name, value] = cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
}

test.describe("locations", () => {
  test("index lists locations and the workspace offers three jobs", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto("/locations")
    await expect(
      page.getByRole("heading", { name: "Locations", level: 1 })
    ).toBeVisible()
    await expect(
      page.getByRole("columnheader", { name: "Location" })
    ).toBeVisible()
    await expect(
      page.getByRole("columnheader", { name: "Google" })
    ).toBeVisible()

    await page.goto(`/locations/${state.primaryLocationId}`)
    const nav = page.getByRole("navigation", { name: "Location sections" })
    for (const job of ["Listing", "Content", "Access"]) {
      await expect(nav.getByRole("link", { name: job })).toBeVisible()
    }
    await expect(nav.getByRole("link", { name: "Listing" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    // The Listing's parts are anchors into one scroll, not routes.
    for (const anchor of ["Business profile", "Hours", "Booking", "Suggested updates"]) {
      await expect(nav.getByRole("link", { name: anchor })).toBeVisible()
    }
    await expect(
      page.getByRole("region", { name: "Hours" }).getByRole("heading", { name: "Opening hours" })
    ).toBeVisible()
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()

    // Content opens on photos and lists its views beneath the switcher.
    await nav.getByRole("link", { name: "Content" }).click()
    await expect(page).toHaveURL(new RegExp(`/locations/${state.primaryLocationId}/photos$`))
    for (const view of ["Photos", "Posts", "Menu"]) {
      await expect(nav.getByRole("link", { name: view })).toBeVisible()
    }
    await expect(nav.getByRole("link", { name: "Performance" })).toHaveCount(0)
  })

  for (const theme of ["light", "dark"] as const) {
    for (const tab of ROUTES) {
      test(`${tab.view ?? tab.job} loads clean (${theme})`, async ({
        baseURL,
        page,
      }) => {
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
          `/locations/${state.primaryLocationId}${tab.segment ? `/${tab.segment}` : ""}`
        )
        const nav = page.getByRole("navigation", { name: "Location sections" })
        await expect(nav).toBeVisible()
        await expect(nav.getByRole("link", { name: tab.job })).toHaveAttribute(
          "aria-current",
          "page"
        )
        if (tab.view) {
          await expect(
            nav.getByRole("link", { name: tab.view })
          ).toHaveAttribute("aria-current", "page")
        }
        await page.waitForLoadState("networkidle")
        const label = tab.view ?? tab.job
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
    await page.goto(`/locations/${state.primaryLocationId}/photos`)
    await page.getByRole("button", { name: "Add photos" }).click()
    await expect(page.getByRole("heading", { name: "Add media" })).toBeVisible()
    await expect(page.getByLabel("Direct file upload")).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Review file upload" })
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
      await page.goto(`/locations/${state.primaryLocationId}`)
      const review = page.getByRole("button", { name: "Review changes" })
      await expect(review).toBeVisible()
      const gate = page.getByText(
        "Only owners and admins can edit this location."
      )
      if (canEdit) {
        // Review is enabled once there is something to publish; what matters
        // here is that nothing tells an owner they may not edit.
        await expect(gate).toHaveCount(0)
        await expect(
          page.getByRole("textbox", { name: "Business name" })
        ).toBeEnabled()
      } else {
        await expect(review).toBeDisabled()
        await expect(gate.first()).toBeVisible()
      }
      await context.close()
    }
  })

  test("console role walk: People/Verification hidden for member/viewer; the business profile stays read-only for everyone", async ({
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
      // gated, never the whole tab.
      await page.goto(`/locations/${state.primaryLocationId}`)
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
          page.getByText("Only owners and admins can edit this location.").first()
        ).toBeVisible()
        expect(
          industryResponses,
          `${cookie} industry GET must never fire for a non-manager`
        ).toEqual([])
      }

      const nav = page.getByRole("navigation", { name: "Location sections" })
      if (canManage) {
        await expect(nav.getByRole("link", { name: "People" })).toBeVisible()
        await expect(
          nav.getByRole("link", { name: "Verification" })
        ).toBeVisible()
      } else {
        await expect(nav.getByRole("link", { name: "People" })).toHaveCount(0)
        await expect(
          nav.getByRole("link", { name: "Verification" })
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
        await page.goto(`/locations/${state.primaryLocationId}/access`)
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
    await page.goto(`/locations/${state.primaryLocationId}`)
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
    // The retired /booking segment forwards to the Listing's booking anchor.
    await page.goto(`/locations/${state.primaryLocationId}/booking`)
    await expect(page).toHaveURL(
      new RegExp(`/locations/${state.primaryLocationId}#booking$`)
    )
    // Not getByLabel("Link"): the Booking type <Select>'s trigger carries
    // aria-label="Booking link type", which contains "Link" as a substring
    // and makes the plain label lookup ambiguous (strict-mode violation).
    // getByRole pins the accessible role too, so it resolves to the single
    // textbox unambiguously.
    await page
      .getByRole("textbox", { name: "Link" })
      .fill("https://book.e2e/reserve")
    const created = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname ===
          `/api/locations/${state.primaryLocationId}/place-actions`
    )
    await page.getByRole("button", { name: "Add booking link" }).click()
    expect((await created).status()).toBe(201)
    await expect(
      page.getByText("Booking link added", { exact: true })
    ).toBeVisible()
  })

  test("listing publish journey: a Google-only field goes out through the same review sheet", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto(`/locations/${state.primaryLocationId}`)
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
    await page.goto(`/locations/${state.primaryLocationId}`)
    // See the note in the listing publish journey: the industry sections load
    // after the editor's first paint.
    await page.waitForLoadState("networkidle")
    const checkin = page.getByLabel("Check-in time")
    await expect(checkin).toBeVisible()
    await checkin.fill("16:00")
    const published = page.waitForResponse(
      (r) =>
        r.request().method() === "PATCH" &&
        new URL(r.url()).pathname ===
          `/api/locations/${state.primaryLocationId}/industry`
    )
    await page.getByRole("button", { name: "Save lodging" }).click()
    expect((await published).status()).toBe(200)
    await expect(
      page.getByText("Lodging details published to Google", { exact: true })
    ).toBeVisible()
  })

  test("verification journey: an owner starts a Google verification (non-destructive)", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto(`/locations/${state.primaryLocationId}/verification`)
    // Administration fans out 7 Google calls, each paced ~500ms apart on the
    // shared connection (lib/server/google.ts's per-connection rate limiter)
    // — a real, deliberate characteristic of the protected server code, not
    // a bug — so wait for the network to settle before asserting content
    // rather than racing the default 5s expect timeout (same pattern as the
    // clean-load loop above).
    await page.waitForLoadState("networkidle")
    // exact: true — "Verification" (unqualified) would otherwise strict-mode
    // match "Verification history" and "Start a new verification" too.
    await expect(
      page.getByRole("heading", { name: "Verification", exact: true })
    ).toBeVisible()
    const published = page.waitForResponse(
      (r) =>
        r.request().method() === "PATCH" &&
        new URL(r.url()).pathname ===
          `/api/locations/${state.primaryLocationId}/administration`
    )
    await page.getByRole("button", { name: "Start verification" }).click()
    expect((await published).status()).toBe(200)
    await expect(
      page.getByText("Verification started", { exact: true })
    ).toBeVisible()
  })

  test("access danger zone: delete stays disabled until the location name is typed", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto(`/locations/${state.primaryLocationId}/access`)
    // See the same note in the publish journey above: Administration's 7-way
    // Google fan-out is genuinely slower than the default 5s expect timeout
    // budgets for.
    await page.waitForLoadState("networkidle")
    await expect(
      page.getByRole("heading", { name: "Danger zone" })
    ).toBeVisible()

    await page.getByRole("button", { name: "Delete this location" }).click()
    const confirm = page.getByRole("button", { name: "Delete location" })
    await expect(confirm).toBeDisabled()
    await page
      .getByLabel("Type the location's name to confirm")
      .fill(state.directReview.locationName)
    await expect(confirm).toBeEnabled()

    const deleted = page.waitForResponse(
      (r) =>
        r.request().method() === "PATCH" &&
        new URL(r.url()).pathname ===
          `/api/locations/${state.primaryLocationId}/administration`
    )
    await confirm.click()
    expect((await deleted).status()).toBe(200)
    await expect(
      page.getByText("Location deleted from Google", { exact: true })
    ).toBeVisible()
  })
})
