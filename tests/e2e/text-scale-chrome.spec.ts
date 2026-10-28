import { expect, test, type Page } from "@playwright/test"

import { pageSettled, profileLoadedFromGoogle } from "./helpers/settled"
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

test.describe("the profile's section strip on a phone", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await applyCookie(page, baseURL)
  })

  // Tall: the strip sticks under the app bar. Short or sideways: the app
  // bar, the strip and the tab bar would cover over 40% of the screen, so
  // the strip scrolls away with the page.
  for (const { width, height, sticks } of [
    { width: 390, height: 844, sticks: true },
    { width: 667, height: 375, sticks: false },
    { width: 568, height: 320, sticks: false },
  ]) {
    test(`${sticks ? "sticks" : "scrolls with the page"} at ${width}x${height}`, async ({
      page,
    }) => {
      const { primaryLocationId } = await readJourneyState()
      await page.setViewportSize({ width, height })
      await page.goto(`/listings/${primaryLocationId}/profile`)
      await profileLoadedFromGoogle(page)
      const nav = page.locator('[data-slot="section-nav"]')
      await expect(nav).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, 1200))
      const appBar = (await page
        .locator('[data-slot="app-bar"]')
        .boundingBox())!
      await expect
        .poll(async () => {
          const box = (await nav.boundingBox())!
          return Math.round(box.y + box.height)
        })
        [sticks ? "toBeGreaterThan" : "toBeLessThanOrEqual"](
          Math.round(appBar.y + appBar.height)
        )
      // The section marked current is one the reader can see, under the
      // app bar, not one that scrolled away above it.
      await expect
        .poll(async () => {
          const id = await nav
            .locator('a[aria-current="location"]')
            .getAttribute("href")
          return page.evaluate(
            ([selector, top]) => {
              const box = document
                .querySelector(selector as string)!
                .getBoundingClientRect()
              return box.bottom > (top as number)
            },
            [id, appBar.y + appBar.height] as const
          )
        })
        .toBe(true)
    })
  }
})
