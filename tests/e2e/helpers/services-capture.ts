import { expect, type Page, type TestInfo } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

import { captureThroughScrollOwner } from "./scroll-owner"

export async function captureServicesPanel(page: Page, info: TestInfo, name: string, selector = "#section-services") {
  const panel = page.locator(selector)
  expect((await new AxeBuilder({ page }).include(selector).analyze()).violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await captureThroughScrollOwner(page, info, panel, name)
}
