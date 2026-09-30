import { expect, type Page, type TestInfo } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

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
  const bounds = await section.evaluate((element) => {
    let parent = element.parentElement
    while (parent && !(["auto", "scroll"].includes(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight)) parent = parent.parentElement
    if (!parent) throw new Error("Lodging scroll owner missing")
    parent.dataset.lodgingCaptureScroll = "true"
    const top = element.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop
    return { top, bottom: top + element.getBoundingClientRect().height, height: parent.clientHeight, maximum: parent.scrollHeight - parent.clientHeight }
  })
  const scroller = page.locator('[data-lodging-capture-scroll="true"]')
  for (let offset = Math.min(bounds.top, bounds.maximum), frame = 0; ; frame++) {
    await scroller.evaluate((element, value) => { element.scrollTop = value }, offset)
    await page.screenshot({ path: info.outputPath(`${name}-${frame}.png`), animations: "disabled" })
    if (offset + bounds.height >= bounds.bottom || offset >= bounds.maximum) break
    offset = Math.min(offset + bounds.height * 0.75, bounds.maximum)
  }
}
