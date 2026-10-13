import { expect, type Page, type TestInfo } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

import { captureThroughScrollOwner } from "./scroll-owner"

/** Capture every visible part of the selected real section in its scroll owner. */
export async function captureVerificationStart(page: Page, info: TestInfo, name: string) {
  return captureVerificationSection(page, info, { name, section: "verification-start" })
}

export async function captureVerificationSection(page: Page, info: TestInfo, capture: { readonly name: string; readonly section: "verification-start" | "verification-pin" | "access-review-workspace" | "access-saved-work" | "people-location" | "people-account" | "people-invitations" | "danger-zone-heading" | "lifecycle-review-title" | "lifecycle-outcome-title" | "lifecycle-saved-work" }) {
  const selector = `section[aria-labelledby="${capture.section}"]`
  const panel = page.locator(selector)
  expect((await new AxeBuilder({ page }).include(selector).analyze()).violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  await captureThroughScrollOwner(page, info, panel, capture.name)
}
