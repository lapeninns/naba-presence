import { expect, type Page, test } from "@playwright/test"

import { readJourneyState } from "./helpers/stub-bridge"

async function applyCookie(
  page: Page,
  baseURL: string | undefined,
  cookie: string
) {
  const [name, value] = cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
}

test.describe("client setup", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
  })

  test("resumes at the step the data has actually reached", async ({
    page,
  }) => {
    // Nothing about the operator's progress is stored: every answer is derived
    // from what exists, so a bare /setup?client=… lands where the work is.
    const state = await readJourneyState()
    await page.goto(`/setup?client=${state.clientId}`)
    await expect(
      page.getByRole("heading", { name: "Client setup", level: 1 })
    ).toBeVisible()
    const stepper = page.getByRole("list", { name: "Setup steps" })
    // All nine steps, Done included (the reference stepper).
    await expect(stepper.getByRole("listitem")).toHaveCount(9)
    // Exactly one step is current, whichever the data resolved to.
    await expect(stepper.locator("[aria-current='step']")).toHaveCount(1)
  })

  test("lets an operator step back without losing completed work", async ({
    page,
  }) => {
    const state = await readJourneyState()
    await page.goto(`/setup?client=${state.clientId}&step=connect`)
    await expect(
      page.getByRole("heading", { name: "Connect Google", level: 2 })
    ).toBeVisible()
    // Both routes are offered: the first client needs a fresh consent, the
    // tenth is usually on a login the agency already connected.
    await expect(
      page.getByRole("button", { name: /Continue with Google/ })
    ).toBeVisible()
    await expect(
      page.getByRole("heading", { name: "Use an account already connected" })
    ).toBeVisible()
  })

  test("refuses to show a step whose prerequisites are missing", async ({
    page,
  }) => {
    // A stale link, or a Back button after something was disconnected. Showing
    // the requested step would present controls that cannot work.
    const state = await readJourneyState()
    await page.goto(`/setup?client=${state.clientId}&step=done`)
    await expect(
      page.getByRole("heading", { name: "This client is set up", level: 2 })
    ).toHaveCount(0)
  })

  test("a bare /setup offers a choice rather than a dead end", async ({
    page,
  }) => {
    // Setup runs for one client at a time, so arriving without one asks which
    // — never a blank page, and never a teleport somewhere unasked-for.
    await page.goto("/setup")
    expect(new URL(page.url()).pathname).toBe("/setup")
    await expect(
      page.getByRole("heading", { name: "Client setup", level: 1 })
    ).toBeVisible()
    await expect(page.getByRole("link", { name: "New client" })).toBeVisible()
  })

  test("offers a way out that does not lose the setup", async ({ page }) => {
    const state = await readJourneyState()
    await page.goto(`/setup?client=${state.clientId}`)
    await page.getByRole("link", { name: "Finish later" }).click()
    await expect(page).toHaveURL(`/clients/${state.clientId}`)
  })
})
