import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, test } from "@playwright/test"

import { readJourneyState } from "./helpers/stub-bridge"

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
const STRUCTURE_RULES = ["landmark-no-duplicate-main", "landmark-main-is-top-level", "heading-order", "page-has-heading-one"]
const TABS = [
  { segment: "", label: "Profile" },
  { segment: "hours", label: "Hours" },
  { segment: "photos", label: "Photos" },
  { segment: "posts", label: "Posts" },
  { segment: "booking", label: "Booking" },
  { segment: "menu", label: "Menu" },
  // The three M8 consoles (Task 8): owner-scoped entries only. Industry and
  // Administration are hidden for non-owner/admin (see the console role walk
  // below), so their clean-load + axe iterations are only meaningful — and
  // only render — under the owner cookie this whole loop already uses.
  { segment: "business-information", label: "Business info" },
  { segment: "industry", label: "Industry" },
  { segment: "administration", label: "Administration" },
] as const

async function applyCookie(page: Page, baseURL: string | undefined, cookie: string) {
  const [name, value] = cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
}

test.describe("locations", () => {
  test("index lists locations and the workspace exposes the wave-1 tabs plus the three M8 consoles", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto("/locations")
    await expect(page.getByRole("heading", { name: "Locations", level: 1 })).toBeVisible()
    await expect(page.getByRole("columnheader", { name: "Location" })).toBeVisible()
    await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible()

    await page.goto(`/locations/${state.primaryLocationId}`)
    const nav = page.getByRole("navigation", { name: "Location sections" })
    for (const tab of TABS) {
      await expect(nav.getByRole("link", { name: tab.label })).toBeVisible()
    }
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  })

  for (const theme of ["light", "dark"] as const) {
    for (const tab of TABS) {
      test(`${tab.label || "Profile"} tab loads clean (${theme})`, async ({ baseURL, page }) => {
        const consoleErrors: string[] = []
        const pageErrors: string[] = []
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push(message.text())
        })
        page.on("pageerror", (error) => pageErrors.push(error.message))
        await page.emulateMedia({ colorScheme: theme })
        const state = await readJourneyState()
        await applyCookie(page, baseURL, state.cookie)
        await page.goto(`/locations/${state.primaryLocationId}${tab.segment ? `/${tab.segment}` : ""}`)
        await expect(page.getByRole("navigation", { name: "Location sections" })).toBeVisible()
        await page.waitForLoadState("networkidle")
        expect(consoleErrors, `${theme} ${tab.label} console`).toEqual([])
        expect(pageErrors, `${theme} ${tab.label} pageerror`).toEqual([])
        const wcag = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
        expect(wcag.violations, `${theme} ${tab.label} wcag`).toEqual([])
        const best = await new AxeBuilder({ page }).withTags(["best-practice"]).analyze()
        expect(best.violations.filter((v) => STRUCTURE_RULES.includes(v.id)), `${theme} ${tab.label} structure`).toEqual([])
      })
    }
  }

  test("photos tab exposes the add-media controls (extracted from gbp-management-tabs)", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto(`/locations/${state.primaryLocationId}/photos`)
    await expect(page.getByText("Add media", { exact: true })).toBeVisible()
    await expect(page.getByLabel("Direct file upload")).toBeVisible()
    await expect(page.getByRole("button", { name: "Review file upload" })).toBeDisabled()
  })

  test("permission walk: owner/admin can edit canonical; member/viewer cannot", async ({ baseURL, browser }) => {
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
      const save = page.getByRole("button", { name: "Save changes" })
      await expect(save).toBeVisible()
      if (canEdit) {
        await expect(save).toBeEnabled().catch(async () => {
          // Enabled once dirty; assert the gate reason is absent instead.
          await expect(page.getByText("Only owners and admins can edit this location.")).toHaveCount(0)
        })
      } else {
        await expect(save).toBeDisabled()
        await expect(page.getByText("Only owners and admins can edit this location.")).toBeVisible()
      }
      await context.close()
    }
  })

  test("console role walk: Industry/Administration hidden for member/viewer; Business info stays read-only for everyone", async ({ baseURL, browser }) => {
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

      // Business info (§9): read-open for every role; only editing is gated,
      // never the whole tab.
      await page.goto(`/locations/${state.primaryLocationId}/business-information`)
      await expect(page.getByRole("heading", { name: "Identity" })).toBeVisible()
      const name = page.getByRole("textbox", { name: "Business name" })
      if (canManage) {
        await expect(name).toBeEnabled()
      } else {
        await expect(name).toBeDisabled()
        await expect(page.getByText("Only owners and admins can edit this location.")).toBeVisible()
      }

      const nav = page.getByRole("navigation", { name: "Location sections" })
      if (canManage) {
        await expect(nav.getByRole("link", { name: "Industry" })).toBeVisible()
        await expect(nav.getByRole("link", { name: "Administration" })).toBeVisible()
      } else {
        await expect(nav.getByRole("link", { name: "Industry" })).toHaveCount(0)
        await expect(nav.getByRole("link", { name: "Administration" })).toHaveCount(0)

        // Industry/Administration gate their own GET on canEditCanonical
        // (D4) before it ever fires — a direct goto of either route must
        // never surface a request (403 or otherwise) to the tab.
        const industryResponses: number[] = []
        page.on("response", (response) => {
          if (new URL(response.url()).pathname === `/api/locations/${state.primaryLocationId}/industry`) {
            industryResponses.push(response.status())
          }
        })
        await page.goto(`/locations/${state.primaryLocationId}/industry`)
        await expect(page.getByText("This section is available to owners and admins")).toBeVisible()
        expect(industryResponses, `${cookie} industry GET must never fire for a non-manager`).toEqual([])

        await page.goto(`/locations/${state.primaryLocationId}/administration`)
        await expect(page.getByText("This section is available to owners and admins")).toBeVisible()
      }

      expect(consoleErrors, `${cookie} console errors`).toEqual([])
      await context.close()
    }
  })

  test("canonical save journey: an owner edits the business name and saves", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto(`/locations/${state.primaryLocationId}`)
    const name = page.getByRole("textbox", { name: "Business name" })
    await expect(name).toBeVisible()
    await name.fill("Riverside Rooms & Spa")
    const saved = page.waitForResponse(
      (r) => r.request().method() === "PUT" && new URL(r.url()).pathname === `/api/locations/${state.primaryLocationId}/profile`
    )
    await page.getByRole("button", { name: "Save changes" }).click()
    expect((await saved).status()).toBe(200)
    await expect(page.getByText("Profile saved", { exact: true })).toBeVisible()
  })

  test("location workspace exposes a Performance tab with review metrics", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto(`/locations/${state.primaryLocationId}`)
    await page.getByRole("navigation", { name: "Location sections" }).getByRole("link", { name: "Performance" }).click()
    await expect(page).toHaveURL(new RegExp(`/locations/${state.primaryLocationId}/performance$`))
    // The section headings are "Review activity" / "Visibility on Google";
    // "Reviews" itself is a StatTile label inside "Review activity", not a
    // heading (see components/performance/location-performance.tsx).
    await expect(page.getByRole("heading", { name: "Review activity" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Visibility on Google" })).toBeVisible()
  })

  test("booking create journey: an owner adds a booking link", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto(`/locations/${state.primaryLocationId}/booking`)
    // Not getByLabel("Link"): the Booking type <Select>'s trigger carries
    // aria-label="Booking link type", which contains "Link" as a substring
    // and makes the plain label lookup ambiguous (strict-mode violation).
    // getByRole pins the accessible role too, so it resolves to the single
    // textbox unambiguously.
    await page.getByRole("textbox", { name: "Link" }).fill("https://book.e2e/reserve")
    const created = page.waitForResponse(
      (r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/api/locations/${state.primaryLocationId}/place-actions`
    )
    await page.getByRole("button", { name: "Add booking link" }).click()
    expect((await created).status()).toBe(201)
    await expect(page.getByText("Booking link added", { exact: true })).toBeVisible()
  })

  test("business information publish journey: an owner edits and publishes the business name to Google", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto(`/locations/${state.primaryLocationId}/business-information`)
    const name = page.getByRole("textbox", { name: "Business name" })
    await expect(name).toBeVisible()
    await name.fill("Riverside Rooms & Spa (Google)")
    await page.getByRole("button", { name: "Publish to Google" }).click()
    await expect(page.getByText("Publish these details to Google?")).toBeVisible()
    // Hash-pinned: the PATCH carries `expectedGoogleHash` from the page's own
    // load, and the route 409s (business_information_stale) if Google's
    // current state no longer hashes to match — a live optimistic-concurrency
    // guard, not a mocked one.
    const published = page.waitForResponse(
      (r) => r.request().method() === "PATCH" && new URL(r.url()).pathname === `/api/locations/${state.primaryLocationId}/business-information`
    )
    await page.getByRole("button", { name: "Publish", exact: true }).click()
    expect((await published).status()).toBe(200)
    await expect(page.getByText("Published to Google", { exact: true })).toBeVisible()
  })

  test("industry publish journey: an owner updates and publishes the lodging check-in time", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto(`/locations/${state.primaryLocationId}/industry`)
    const checkin = page.getByLabel("Check-in time")
    await expect(checkin).toBeVisible()
    await checkin.fill("16:00")
    const published = page.waitForResponse(
      (r) => r.request().method() === "PATCH" && new URL(r.url()).pathname === `/api/locations/${state.primaryLocationId}/industry`
    )
    await page.getByRole("button", { name: "Save lodging" }).click()
    expect((await published).status()).toBe(200)
    await expect(page.getByText("Lodging details published to Google", { exact: true })).toBeVisible()
  })

  test("administration publish journey: an owner starts a Google verification (non-destructive)", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto(`/locations/${state.primaryLocationId}/administration`)
    // Administration fans out 7 Google calls, each paced ~500ms apart on the
    // shared connection (lib/server/google.ts's per-connection rate limiter)
    // — a real, deliberate characteristic of the protected server code, not
    // a bug — so wait for the network to settle before asserting content
    // rather than racing the default 5s expect timeout (same pattern as the
    // clean-load loop above).
    await page.waitForLoadState("networkidle")
    // exact: true — "Verification" (unqualified) would otherwise strict-mode
    // match "Verification history" and "Start a new verification" too.
    await expect(page.getByRole("heading", { name: "Verification", exact: true })).toBeVisible()
    const published = page.waitForResponse(
      (r) => r.request().method() === "PATCH" && new URL(r.url()).pathname === `/api/locations/${state.primaryLocationId}/administration`
    )
    await page.getByRole("button", { name: "Start verification" }).click()
    expect((await published).status()).toBe(200)
    await expect(page.getByText("Verification started", { exact: true })).toBeVisible()
  })

  test("administration danger zone: delete stays disabled until the location name is typed", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto(`/locations/${state.primaryLocationId}/administration`)
    // See the same note in the publish journey above: Administration's 7-way
    // Google fan-out is genuinely slower than the default 5s expect timeout
    // budgets for.
    await page.waitForLoadState("networkidle")
    await expect(page.getByRole("heading", { name: "Danger zone" })).toBeVisible()

    await page.getByRole("button", { name: "Delete this location" }).click()
    const confirm = page.getByRole("button", { name: "Delete location" })
    await expect(confirm).toBeDisabled()
    await page.getByLabel("Type the location's name to confirm").fill(state.directReview.locationName)
    await expect(confirm).toBeEnabled()

    const deleted = page.waitForResponse(
      (r) => r.request().method() === "PATCH" && new URL(r.url()).pathname === `/api/locations/${state.primaryLocationId}/administration`
    )
    await confirm.click()
    expect((await deleted).status()).toBe(200)
    await expect(page.getByText("Location deleted from Google", { exact: true })).toBeVisible()
  })
})
