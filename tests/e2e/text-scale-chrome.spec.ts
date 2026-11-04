import { expect, test, type Page } from "@playwright/test"

import { pageSettled } from "./helpers/settled"
import { readJourneyState } from "./helpers/stub-bridge"

// The shell's fixed chrome under the two things a phone user changes about
// the screen: the browser's text size (Chrome's Settings → Font size, which
// sets the default font every rem follows) and holding the phone sideways.
// The chrome is drawn in px while its contents are rem, so each test checks
// what a person would see, not a class name.

async function applyCookie(page: Page, baseURL: string | undefined) {
  const { cookie } = await readJourneyState()
  const [name, value] = cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
}

/** The browser's default font size, as the Font size setting sets it. */
async function setDefaultFontSize(page: Page, px: number) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Page.enable")
  await cdp.send("Page.setFontSizes", {
    fontSizes: { standard: px, fixed: px - 3 },
  })
}

test.describe("shell chrome with enlarged text", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await applyCookie(page, baseURL)
  })

  for (const fontSize of [16, 24, 32]) {
    test(`the tab bar keeps its labels on screen at a ${fontSize}px default font`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await setDefaultFontSize(page, fontSize)
      await page.goto("/inbox")
      await pageSettled(page)
      const bar = page.locator('[data-slot="tab-bar"]')
      await expect(bar).toBeVisible()
      const barBox = (await bar.boundingBox())!
      // Unchanged at the default size: the bar is the 56px it was drawn at.
      if (fontSize === 16) expect(Math.round(barBox.height)).toBe(56)
      for (const label of ["Inbox", "Listings", "Clients", "Reports", "More"]) {
        const text = bar.getByText(label, { exact: true })
        await expect(text).toBeVisible()
        const box = (await text.boundingBox())!
        expect(box.y).toBeGreaterThanOrEqual(barBox.y)
        expect(box.y + box.height).toBeLessThanOrEqual(844)
      }
    })
  }

  test("the skip link stays out of sight until it is focused, at a 32px default font", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await setDefaultFontSize(page, 32)
    await page.goto("/inbox")
    await pageSettled(page)
    const skip = page.getByRole("link", { name: "Skip to content" })
    const hidden = (await skip.boundingBox())!
    expect(hidden.y + hidden.height).toBeLessThanOrEqual(0)
    await page.keyboard.press("Tab")
    await expect(skip).toBeFocused()
    await expect
      .poll(async () => (await skip.boundingBox())!.y)
      .toBeGreaterThanOrEqual(0)
  })
})

test.describe("the profile's section index on a phone", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await applyCookie(page, baseURL)
  })

  // The section index stays in the page flow at all phone heights.
  for (const { width, height } of [
    { width: 390, height: 844 },
    { width: 667, height: 375 },
    { width: 568, height: 320 },
  ]) {
    test(`opens and returns to a section at ${width}x${height}`, async ({
      page,
    }) => {
      const { primaryLocationId } = await readJourneyState()
      await page.setViewportSize({ width, height })
      await page.goto(`/listings/${primaryLocationId}/profile`)
      const nav = page.getByRole("navigation", { name: "Profile sections" })
      const identity = nav.getByRole("button", {
        name: "Identity",
        exact: true,
      })
      const businessName = page.getByRole("textbox", { name: "Business name" })
      await expect(identity).toBeVisible()
      await expect(businessName).toBeHidden()
      await identity.press("Enter")
      await expect(page).toHaveURL(/\?section=identity$/)
      await expect(
        page.getByRole("heading", { name: "Identity", exact: true })
      ).toBeFocused()
      await expect(businessName).toBeVisible()
      await nav.getByRole("link", { name: "All sections", exact: true }).click()
      await expect(page).toHaveURL(/\/profile$/)
      await expect(identity).toBeFocused()
      await expect(businessName).toBeHidden()
    })
  }
})

test.describe("the profile's section strip on a touch tablet", () => {
  test.use({ hasTouch: true, viewport: { width: 834, height: 1112 } })

  test("stays visible when its editor pane scrolls and can scroll sideways", async ({
    page,
    baseURL,
  }) => {
    await applyCookie(page, baseURL)
    const { primaryLocationId } = await readJourneyState()
    await page.goto(`/listings/${primaryLocationId}/profile`)
    const pane = page.locator(
      '[role="region"][aria-label="Business profile"][tabindex="0"]'
    )
    const nav = pane.getByRole("navigation", { name: "Profile sections" })
    await expect(nav.getByRole("link", { name: "Identity" })).toBeVisible()
    await pageSettled(page)

    const strip = nav.getByRole("list")
    await expect
      .poll(() => strip.evaluate((list) => list.scrollWidth - list.clientWidth))
      .toBeGreaterThan(0)
    await strip.evaluate((list) => (list.scrollLeft = 100))
    await expect
      .poll(() => strip.evaluate((list) => list.scrollLeft))
      .toBeGreaterThan(0)

    await pane.evaluate((editor) => (editor.scrollTop = 1200))
    await expect
      .poll(() => pane.evaluate((editor) => editor.scrollTop))
      .toBeGreaterThan(300)
    await expect
      .poll(async () => {
        const [header, editor] = await Promise.all([
          nav.boundingBox(),
          pane.boundingBox(),
        ])
        return Math.abs(header!.y - editor!.y)
      })
      .toBeLessThanOrEqual(2)
    const current = nav.locator('a[aria-current="location"]')
    await expect(current).toHaveCount(1)
    const href = (await current.getAttribute("href"))!
    const [section, header] = await Promise.all([
      page.locator(href).boundingBox(),
      nav.boundingBox(),
    ])
    expect(section!.y + section!.height).toBeGreaterThan(
      header!.y + header!.height
    )
  })
})
