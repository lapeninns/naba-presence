import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, type TestInfo } from "@playwright/test"

/**
 * Waits until no colour or opacity transition is running. A control that
 * keeps its place across a step (the sheet's "Review invitation" button
 * becomes "Check saved access outcome") eases between its variants for the
 * button's 140 ms, and axe samples the midway colours: #6a7176 text on a
 * half-green fill is a frame, not a state anyone can rest in. The audit
 * runs on the settled state, never with a rule switched off.
 */
async function settled(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.getAnimations().filter((animation) => animation instanceof CSSTransition && animation.playState === "running").length
      )
    )
    .toBe(0)
}

export async function captureAccessDialog(page: Page, info: TestInfo, name: string) {
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await expect.poll(() => dialog.evaluate((element) => getComputedStyle(element).opacity)).toBe("1")
  await expect.poll(() => page.locator('[data-slot="dialog-overlay"]').evaluate((element) => getComputedStyle(element).opacity)).toBe("1")
  await settled(page)
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath(`${name}.png`), animations: "disabled" })
}

/** The invitation sheet (a toast is also a dialog, so it is found by its slot): visible and settled, free of axe violations and of horizontal scroll. */
export async function captureAccessSheet(page: Page, info: TestInfo, name: string) {
  const sheet = page.locator('[data-slot="sheet-content"]')
  await expect(sheet).toBeVisible()
  await expect.poll(() => sheet.evaluate((element) => getComputedStyle(element).opacity)).toBe("1")
  await settled(page)
  expect((await new AxeBuilder({ page }).include('[data-slot="sheet-content"]').analyze()).violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath(`${name}.png`), animations: "disabled" })
}
