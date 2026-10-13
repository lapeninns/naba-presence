import { expect, type Page, type TestInfo } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

import { captureThroughScrollOwner } from "./scroll-owner"

// The sheet is titled as a review until a request is recorded, then as its outcome.
export const lodgingSheet = /^(Review changes|Saved lodging outcome)$/
export const lodgingEditor = (page: Page) => page.getByRole("region", { name: "Lodging details", exact: true })
export async function captureLodgingDialog(page: Page, info: TestInfo, name: string) {
  const dialog = page.getByRole("dialog", { name: lodgingSheet })
  await expect(dialog).toBeVisible()
  await expect.poll(() => dialog.evaluate((element) => getComputedStyle(element).opacity)).toBe("1")
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath(`${name}.png`), animations: "disabled" })
}
export async function captureLodging(page: Page, info: TestInfo, name: string) {
  const section = lodgingEditor(page)
  expect((await new AxeBuilder({ page }).include('section[aria-labelledby$="-title"]').analyze()).violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.evaluate(() => window.scrollTo(0, 0))
  await captureThroughScrollOwner(page, info, section, name)
}
