import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, test } from "@playwright/test"

import { readJourneyState } from "./helpers/stub-bridge"

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
const STRUCTURE_RULES = ["landmark-no-duplicate-main", "landmark-main-is-top-level", "heading-order", "page-has-heading-one"]
// Team left Settings for its own destination, and Listing is gone: it
// administered a location from a page nowhere near it, and that now lives in
// the location's own Access section. Compliance and Operations are gone too —
// their routes are still served under `/api/privacy/**`, `/api/legal-holds`
// and `/api/operations/health`, owner/admin-gated as they always were.
const AREAS = [
  { path: "/settings", heading: "Reply policy" },
  { path: "/settings/connections", heading: "Google Business Profile" },
] as const

async function applyCookie(page: Page, baseURL: string | undefined, cookie: string) {
  const [name, value] = cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
}

test.describe("settings", () => {
  test("each area is a sibling route with its own level-1 heading and a shared sub-nav", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    for (const area of AREAS) {
      await page.goto(area.path)
      await expect(page).toHaveURL(new RegExp(`${area.path.replace("/", "\\/")}$`))
      await expect(page.getByRole("heading", { name: area.heading, level: 1 })).toBeVisible()
      await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeVisible()
    }
  })

  test("/connections redirects under settings and forwards the query string", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto("/connections?google=connected")
    await expect(page).toHaveURL(/\/settings\/connections\?google=connected$/)
  })

  for (const theme of ["light", "dark"] as const) {
    for (const area of AREAS) {
      test(`${area.heading} loads clean (${theme})`, async ({ baseURL, page }) => {
        const consoleErrors: string[] = []
        const pageErrors: string[] = []
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push(message.text())
        })
        page.on("pageerror", (error) => pageErrors.push(error.message))
        await page.emulateMedia({ colorScheme: theme })
        const state = await readJourneyState()
        await applyCookie(page, baseURL, state.cookie)
        await page.goto(area.path)
        await expect(page.getByRole("heading", { name: area.heading, level: 1 })).toBeVisible()
        await page.waitForLoadState("networkidle")
        expect(consoleErrors, `${theme} ${area.heading} console`).toEqual([])
        expect(pageErrors, `${theme} ${area.heading} pageerror`).toEqual([])
        const wcag = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
        expect(wcag.violations, `${theme} ${area.heading} wcag`).toEqual([])
        const best = await new AxeBuilder({ page }).withTags(["best-practice"]).analyze()
        expect(best.violations.filter((v) => STRUCTURE_RULES.includes(v.id)), `${theme} ${area.heading} structure`).toEqual([])
      })
    }
  }

  test("permission walk: a member sees only Policy, and is TOLD when a route is closed", async ({ baseURL, browser }) => {
    const state = await readJourneyState()
    for (const cookie of [state.memberUnassignedCookie, state.viewerCookie]) {
      const context = await browser.newContext()
      const page = await context.newPage()
      await applyCookie(page, baseURL, cookie)
      await page.goto("/settings")
      const nav = page.getByRole("navigation", { name: "Settings sections" })
      await expect(nav.getByRole("link", { name: "Policy" })).toBeVisible()
      for (const gone of ["Team", "Compliance", "Connections", "Listing", "Operations"]) {
        await expect(nav.getByRole("link", { name: gone })).toHaveCount(0)
      }
      // The read-only Policy form shows the gate reason, not an editable control.
      await expect(page.getByText("Only owners and admins can change these settings.")).toBeVisible()

      // Following a colleague's link to a privileged route explains the
      // refusal instead of silently landing somewhere else, which is
      // indistinguishable from a bug.
      for (const privileged of ["/settings/connections"]) {
        await page.goto(privileged)
        expect(new URL(page.url()).pathname).toBe(privileged)
        await expect(
          page.getByRole("heading", { name: /You don.t have access to this page/, level: 1 })
        ).toBeVisible()
        await expect(page.getByRole("link", { name: "Back to Home" })).toBeVisible()
      }
      await context.close()
    }
  })

  test("an admin keeps Policy and Connections, and Team as a primary destination", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.adminCookie)
    await page.goto("/settings")
    const nav = page.getByRole("navigation", { name: "Settings sections" })
    await expect(nav.getByRole("link", { name: "Connections" })).toBeVisible()
    // Team is a primary destination now, not a settings tab.
    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Team" })
    ).toBeVisible()
    // The compliance console is gone for every role, admin included.
    for (const gone of ["Compliance", "Operations"]) {
      await expect(nav.getByRole("link", { name: gone })).toHaveCount(0)
    }
  })
})
