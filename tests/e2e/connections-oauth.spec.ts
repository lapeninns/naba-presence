import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, test } from "@playwright/test"

import { readJourneyState } from "./helpers/stub-bridge"

async function applyCookie(page: Page, baseURL: string | undefined, cookie: string) {
  const [name, value] = cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
}

test.describe("connections OAuth return", () => {
  test("a successful return toasts and clears the query", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto("/settings/connections?google=connected")
    await expect(page.getByText("Google Business Profile connected")).toBeVisible()
    await expect(page).toHaveURL(/\/settings\/connections$/)
  })

  test("a failed return shows a mapped error and a Try again action without leaking the code", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto("/settings/connections?google=error&status=502")
    await expect(page.getByText(/temporarily unavailable/i)).toBeVisible()
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible()
    await expect(page.getByText(/status=502/)).toHaveCount(0)
  })

  // Stub-bridge tenant fix (tests/e2e/helpers/stub-bridge.ts): two Google
  // stub handlers on the identical `{ method: "GET", pathIncludes: "/accounts" }`
  // matcher (one per tenant) used to shadow each other via last-registered-wins,
  // so the primary org's own real GBP account name never actually resolved.
  //
  // The account picker moved to the setup flow, where choosing accounts
  // happens against a named client, so this asserts there.
  test("the primary org's accounts list resolves its own account name", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto(`/setup?client=${state.clientId}&step=account`)
    await expect(page.getByText("Sprint 5 Stub account")).toBeVisible()
  })

  test("axe passes with the disconnect confirmation dialog open", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto("/settings/connections")
    const disconnect = page.getByRole("button", { name: /^Disconnect/ })
    await expect(disconnect.first()).toBeVisible()
    await disconnect.first().click()
    const dialog = page.getByRole("alertdialog")
    await expect(dialog).toBeVisible()
    // The popup fades and scales in (components/ui/alert-dialog.tsx). Axe
    // samples computed colours, so mid-transition it reads the buttons at
    // partial opacity and reports a contrast failure that no one can see.
    await expect(dialog).not.toHaveAttribute("data-starting-style", /.*/)
    await page.waitForTimeout(400)
    const wcag = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze()
    expect(wcag.violations).toEqual([])
  })
})
