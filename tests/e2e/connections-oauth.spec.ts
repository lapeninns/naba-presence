import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, test } from "@playwright/test"

import { transitionsSettled } from "./helpers/settled"
import { readJourneyState } from "./helpers/stub-bridge"

async function applyCookie(
  page: Page,
  baseURL: string | undefined,
  cookie: string
) {
  const [name, value] = cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
}

test.describe("connections OAuth return", () => {
  test("a successful return toasts and clears the query", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto("/settings/connections?google=connected")
    await expect(
      page.getByText("Google Business Profile connected")
    ).toBeVisible()
    await expect(page).toHaveURL(/\/settings\/connections$/)
  })

  test("a failed return shows a mapped error and a Try again action without leaking the code", async ({
    baseURL,
    page,
  }) => {
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
  test("the primary org's accounts list resolves its own account name", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto(`/setup?client=${state.clientId}&step=account`)
    await expect(page.getByText("Sprint 5 Stub account")).toBeVisible()
  })

  test("axe passes with the disconnect confirmation dialog open", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto("/settings/connections")
    // Disconnect is the last item in the account's ⋯ menu, not a button in
    // the headline spot.
    const actions = page.getByRole("button", { name: /^Actions for / })
    await expect(actions.first()).toBeVisible()
    await actions.first().click()
    await page.getByRole("menuitem", { name: /^Disconnect/ }).click()
    const dialog = page.getByRole("alertdialog")
    await expect(dialog).toBeVisible()
    // The popup fades and scales in (components/ui/alert-dialog.tsx). Axe
    // samples computed colours, so mid-transition it reads the buttons at
    // partial opacity and reports a contrast failure that no one can see.
    await expect(dialog).not.toHaveAttribute("data-starting-style", /.*/)
    await transitionsSettled(page)
    const wcag = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze()
    expect(wcag.violations).toEqual([])
  })

  test("on a phone the app bar takes over Connect another account once the header button has scrolled away", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await page.setViewportSize({ width: 390, height: 844 })
    await applyCookie(page, baseURL, state.cookie)
    await page.goto("/settings/connections")
    const header = page
      .getByRole("main")
      .getByRole("button", { name: "Connect another account" })
    const barAction = page
      .locator('header[data-slot="app-bar"]')
      .getByRole("button", { name: "Connect another account" })
    await expect(header).toBeVisible()
    // Before scrolling the header owns it: never two on screen.
    await expect(barAction).toHaveCount(0)

    // Scroll until the header button is under the app bar.
    await header.evaluate((element) => {
      const top =
        document.querySelector('[data-slot="app-bar"]')?.getBoundingClientRect()
          .height ?? 0
      window.scrollBy(0, element.getBoundingClientRect().bottom - top + 8)
    })
    await expect(barAction).toBeVisible()
    // The header button sits under the sticky bar now (still "in the
    // viewport", but covered): its bottom edge is above the bar's.
    const covered = await header.evaluate((element) => {
      const bar = document.querySelector('[data-slot="app-bar"]')
      return (
        element.getBoundingClientRect().bottom <=
        (bar?.getBoundingClientRect().bottom ?? 0)
      )
    })
    expect(covered).toBe(true)
    const box = await barAction.boundingBox()
    expect(box!.width).toBeGreaterThanOrEqual(44)
    expect(box!.height).toBeGreaterThanOrEqual(44)

    // And back at the top the header has it again.
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(barAction).toHaveCount(0)
    await expect(header).toBeVisible()
  })
})
