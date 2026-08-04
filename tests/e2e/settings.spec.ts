import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, test } from "@playwright/test"

import { readJourneyState } from "./helpers/stub-bridge"

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
const STRUCTURE_RULES = ["landmark-no-duplicate-main", "landmark-main-is-top-level", "heading-order", "page-has-heading-one"]
const AREAS = [
  { path: "/settings", heading: "Reply policy" },
  { path: "/settings/team", heading: "Team access" },
  { path: "/settings/compliance", heading: "Data and compliance" },
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

  test("permission walk: a member sees only Policy; privileged routes redirect", async ({ baseURL, browser }) => {
    const state = await readJourneyState()
    for (const cookie of [state.memberUnassignedCookie, state.viewerCookie]) {
      const context = await browser.newContext()
      const page = await context.newPage()
      await applyCookie(page, baseURL, cookie)
      await page.goto("/settings")
      const nav = page.getByRole("navigation", { name: "Settings sections" })
      await expect(nav.getByRole("link", { name: "Policy" })).toBeVisible()
      for (const gone of ["Team", "Compliance", "Connections", "Listing"]) {
        await expect(nav.getByRole("link", { name: gone })).toHaveCount(0)
      }
      // The read-only Policy form shows the gate reason, not an editable control.
      await expect(page.getByText("Only owners and admins can change these settings.")).toBeVisible()
      // A direct visit to a privileged route redirects to Policy.
      for (const privileged of ["/settings/team", "/settings/listing"]) {
        await page.goto(privileged)
        await expect(page).toHaveURL(/\/settings$/)
      }
      await context.close()
    }
  })

  test("an admin sees Compliance and its list/create, but not the owner-only controls", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.adminCookie)
    await page.goto("/settings")
    const nav = page.getByRole("navigation", { name: "Settings sections" })
    await expect(nav.getByRole("link", { name: "Team" })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Compliance" })).toBeVisible()
    // The page renders for admins (no redirect) with the privacy-request create form…
    await page.goto("/settings/compliance")
    await expect(page).toHaveURL(/\/settings\/compliance$/)
    await expect(page.getByRole("heading", { name: "Data and compliance", level: 1 })).toBeVisible()
    await expect(page.getByRole("button", { name: "Log request" })).toBeVisible()
    // …but the owner-only export card and legal-holds card are absent.
    await expect(page.getByRole("button", { name: "Download export" })).toHaveCount(0)
    await expect(page.getByRole("heading", { name: "Legal holds" })).toHaveCount(0)
  })
})
