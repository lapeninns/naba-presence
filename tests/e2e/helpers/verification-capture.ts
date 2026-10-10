import { expect, type Page, type TestInfo } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

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
  const bounds = await panel.evaluate((element) => {
    let parent: HTMLElement | null = element.parentElement
    while (parent && !["auto", "scroll"].includes(getComputedStyle(parent).overflowY)) parent = parent.parentElement
    if (!parent) throw new Error("Verification scroll owner missing")
    parent.dataset.verificationStartScroll = "true"
    const sectionTop = element.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop
    const inset = Number.parseFloat(getComputedStyle(parent).scrollPaddingTop) || 0
    const top = Math.max(0, sectionTop - inset)
    const bottom = sectionTop + element.getBoundingClientRect().height
    return { top, bottom, height: parent.clientHeight, maximum: parent.scrollHeight - parent.clientHeight }
  })
  const scroller = page.locator('[data-verification-start-scroll="true"]')
  for (let top = Math.min(bounds.top, bounds.maximum), frame = 0; ; frame++) {
    await scroller.evaluate((element, offset) => { element.scrollTop = offset }, top)
    await page.screenshot({ path: info.outputPath(`${capture.name}-${frame}.png`), animations: "disabled" })
    if (top + bounds.height >= bounds.bottom || top >= bounds.maximum) break
    top = Math.min(top + bounds.height * 0.75, bounds.maximum)
  }
}
