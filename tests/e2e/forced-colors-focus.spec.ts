import { expect, type Locator, type Page, test } from "@playwright/test"

import { readJourneyState } from "./helpers/stub-bridge"

async function signIn(page: Page, baseURL: string | undefined) {
  const state = await readJourneyState()
  const [name, value] = state.cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
  return state
}

async function focusOutline(target: Locator, offset = 0) {
  await expect(target).toBeFocused()
  const style = await target.evaluate((node) => {
    const css = getComputedStyle(node)
    const rect = node.getBoundingClientRect()
    return {
      focusVisible: node.matches(":focus-visible"),
      shadow: css.boxShadow,
      style: css.outlineStyle,
      width: Number.parseFloat(css.outlineWidth),
      offset: Number.parseFloat(css.outlineOffset),
      color: css.outlineColor,
      clipped: css.clip !== "auto" || css.clipPath !== "none",
      boxWidth: rect.width,
      boxHeight: rect.height,
    }
  })
  expect(style.focusVisible).toBe(true)
  expect(style.shadow).toBe("none")
  expect(style.style).toBe("solid")
  expect(style.width).toBeGreaterThanOrEqual(2)
  expect(style.offset).toBe(offset)
  expect(style.color).not.toMatch(/transparent|rgba\([^)]*,\s*0\s*\)/)
  expect(style.clipped).toBe(false)
  expect(style.boxWidth).toBeGreaterThan(10)
  expect(style.boxHeight).toBeGreaterThan(10)
}

for (const width of [390, 1280]) {
  test(`profile section headings draw real forced-colours outlines at ${width}`, async ({
    page,
    baseURL,
  }, testInfo) => {
    const state = await signIn(page, baseURL)
    await page.setViewportSize({ width, height: 844 })
    await page.emulateMedia({ forcedColors: "active" })
    await page.goto(`/listings/${state.primaryLocationId}/profile`)
    await page.waitForLoadState("networkidle")
    expect(
      await page.evaluate(() => matchMedia("(forced-colors: active)").matches)
    ).toBe(true)
    const nav = page.getByRole("navigation", { name: "Profile sections" })
    const identity = page.locator("#section-identity-heading")
    if (width === 390) {
      expect(await identity.boundingBox()).toMatchObject({
        width: 1,
        height: 1,
      })
    }
    // Keyboard activation must reach the actual group heading, rather than
    // leaving a passing ring on the navigation link that initiated the jump.
    for (const name of ["Identity", "Categories", "Contact"]) {
      await nav.getByRole("link", { name, exact: true }).focus()
      await page.keyboard.press("Enter")
      const heading = page.locator(`#section-${name.toLowerCase()}-heading`)
      await focusOutline(heading)
      const strip = await nav.boundingBox()
      const box = await heading.boundingBox()
      if (width === 390) {
        expect(box!.y).toBeGreaterThanOrEqual(
          Math.floor(strip!.y + strip!.height)
        )
      } else {
        expect(box!.x).toBeGreaterThanOrEqual(
          Math.floor(strip!.x + strip!.width)
        )
      }
      await page.screenshot({
        path: testInfo.outputPath(
          `${name.toLowerCase()}-${width}-forced-colors.png`
        ),
      })
      await page.keyboard.press("Tab")
      await expect(heading).not.toBeFocused()
      if (name === "Identity" && width === 390) {
        expect(await identity.boundingBox()).toMatchObject({
          width: 1,
          height: 1,
        })
      }
    }
    const additional = page.getByText("Additional categories", { exact: true })
    await additional.focus()
    await focusOutline(additional)
  })

  test(`shared row and sheet outlines survive forced colours at ${width}`, async ({
    page,
    baseURL,
  }, testInfo) => {
    await signIn(page, baseURL)
    await page.setViewportSize({ width, height: 844 })
    await page.emulateMedia({ forcedColors: "active" })
    await page.goto("/design-system")
    await page.keyboard.press("Tab")
    const row = page.getByRole("button", { name: /Amelia Hart/ }).first()
    await row.focus()
    await focusOutline(row, -2)
    // Existing halo and inset recipes are positive controls. Their system
    // outlines must remain usable beside the repaired width-only recipes.
    const open = page.getByRole("button", { name: "Open a sheet", exact: true })
    await open.focus()
    await focusOutline(open, 2)
    const tab = page.getByRole("tab", { name: "Overview", exact: true }).first()
    await tab.focus()
    await focusOutline(tab, -2)
    await open.focus()
    await page.keyboard.press("Enter")
    const title = page.getByRole("heading", { name: "Sheet", exact: true })
    await expect(title).toBeVisible()
    await title.focus()
    await focusOutline(title, -2)
    await expect
      .poll(async () => (await title.boundingBox())!.x)
      .toBeLessThan(width)
    await expect
      .poll(async () => (await title.boundingBox())!.y)
      .toBeLessThan(844)
    await page.screenshot({
      path: testInfo.outputPath(`sheet-${width}-forced-colors.png`),
    })
    await page.keyboard.press("Escape")
    const recipes = [
      ["Input", page.locator('[data-slot="input"]').first()],
      ["Textarea", page.locator('[data-slot="textarea"]').first()],
      ["SearchInput", page.locator('input[type="search"]')],
      ["SelectTrigger", page.locator('[data-slot="select-trigger"]').first()],
      [
        "ValidationSummary",
        page.locator('[data-slot="validation-summary"]').first(),
      ],
      ["TabsPanel", page.locator('[role="tabpanel"][tabindex]').first()],
      ["TagInput", page.locator('[data-slot="tag-input"] input').first()],
    ] as const
    for (const [name, target] of recipes) {
      const focusTarget = target
      await focusTarget.focus()
      await expect(focusTarget).toBeFocused()
      await focusOutline(
        target,
        ["SearchInput", "TabsPanel", "TagInput"].includes(name) ? -2 : 2
      )
    }
    const showUndo = page.getByRole("button", {
      name: "Local · Undo",
      exact: true,
    })
    await showUndo.focus()
    await page.keyboard.press("Enter")
    const toast = page.locator('[data-slot="toast"]').first()
    await toast.focus()
    await focusOutline(toast, -2)
    const action = page.locator('[data-slot="toast-action"]').first()
    await action.focus()
    await focusOutline(action, -2)
    const close = page.locator('[data-slot="toast-close"]').first()
    await close.focus()
    await focusOutline(close, 2)
    await close.click()
    await page
      .getByRole("button", { name: "Google write · phases", exact: true })
      .focus()
    await page.keyboard.press("Enter")
    const link = page.locator('[data-slot="toast-link"]')
    await expect(link).toBeVisible()
    await link.focus()
    await focusOutline(link, -2)
  })
}

test("Identity stays quiet after emulated touch, reveals for keyboard, and hides after Tab", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })
  try {
    const page = await context.newPage()
    const state = await signIn(page, baseURL)
    await page.goto(`${baseURL}/listings/${state.primaryLocationId}/profile`)
    await page.waitForLoadState("networkidle")
    const nav = page.getByRole("navigation", { name: "Profile sections" })
    const heading = page.locator("#section-identity-heading")
    const quiet = async () => {
      expect(await heading.boundingBox()).toMatchObject({ width: 1, height: 1 })
      expect(
        await heading.evaluate((node) => node.matches(":focus-visible"))
      ).toBe(false)
    }
    await quiet()
    await nav.getByRole("link", { name: "Categories", exact: true }).tap()
    await nav.getByRole("link", { name: "Identity", exact: true }).tap()
    await expect(heading).toBeFocused()
    await quiet()
    await nav.getByRole("link", { name: "Identity", exact: true }).focus()
    await page.keyboard.press("Enter")
    await expect(heading).toBeFocused()
    await expect
      .poll(async () => (await heading.boundingBox())!.width)
      .toBeGreaterThan(30)
    await page.keyboard.press("Tab")
    await expect(heading).not.toBeFocused()
    await quiet()
  } finally {
    await context.close()
  }
})

test("revealed swipe action keeps a real inset outline in forced colours", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    forcedColors: "active",
  })
  try {
    const page = await context.newPage()
    await signIn(page, baseURL)
    await page.goto(`${baseURL}/design-system`)
    const row = page
      .locator('#ux-p10-row-actions [data-slot="list-row-swipe"]')
      .first()
    await row.scrollIntoViewIfNeeded()
    const box = (await row.boundingBox())!
    const cdp = await context.newCDPSession(page)
    for (const [type, x] of [
      ["touchStart", box.x + box.width - 40],
      ["touchMove", box.x + 25],
      ["touchEnd", 0],
    ] as const) {
      await cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints:
          type === "touchEnd" ? [] : [{ x, y: box.y + box.height / 2 }],
      })
    }
    await expect(row).toHaveAttribute("data-open", "true")
    // A touch reveal followed by keyboard modality exercises the actual
    // hidden-until-revealed action, without changing the demo's data.
    await page.keyboard.press("Shift")
    const action = row.locator('[data-slot="list-row-swipe-action"]').first()
    await action.focus()
    await focusOutline(action, -2)
  } finally {
    await context.close()
  }
})

test("filling the ninth additional category returns keyboard focus to its stable label", async ({
  page,
  baseURL,
}) => {
  const state = await signIn(page, baseURL)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ forcedColors: "active" })
  // Only disposable browser responses change. No profile is saved and no
  // request reaches the provider: the ninth selection is an unsaved draft.
  await page.route(/\/business-information\?type=categories(?:&|$)/, (route) =>
    route.fulfill({
      json: {
        result: {
          categories: Array.from({ length: 9 }, (_, index) => ({
            name: `categories/gcid:focus_fixture_${index}`,
            displayName: `Fixture category ${index + 1}`,
          })),
        },
      },
    })
  )
  await page.goto(`/listings/${state.primaryLocationId}/profile`)
  const opener = page.getByRole("button", {
    name: "Add another category",
    exact: true,
  })
  await opener.focus()
  await page.keyboard.press("Enter")
  await page
    .getByLabel("Search Google categories", { exact: true })
    .fill("fixture")
  for (let index = 1; index <= 9; index++) {
    const choice = page.getByRole("checkbox", {
      name: `Fixture category ${index}`,
      exact: true,
    })
    await expect(choice).toBeVisible()
    await choice.focus()
    await page.keyboard.press("Space")
    await expect(choice).toBeChecked()
  }
  await page.keyboard.press("Escape")
  await expect(opener).toBeDisabled()
  const label = page.getByText("Additional categories", { exact: true })
  await focusOutline(label)
})
