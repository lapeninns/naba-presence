import { expect, type Page, type TestInfo } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

export async function captureServicesPanel(page: Page, info: TestInfo, name: string, selector = "#section-services") {
  const panel = page.locator(selector)
  expect((await new AxeBuilder({ page }).include(selector).analyze()).violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const bounds = await panel.evaluate((element) => {
    for (const previous of document.querySelectorAll("[data-services-capture-scroll]")) previous.removeAttribute("data-services-capture-scroll")
    let parent = element.parentElement
    while (parent && !["auto", "scroll"].includes(getComputedStyle(parent).overflowY)) parent = parent.parentElement
    if (!parent) throw new Error("Services scroll owner missing")
    parent.dataset.servicesCaptureScroll = "true"
    const top = element.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop
    return { top: Math.max(0, top - (Number.parseFloat(getComputedStyle(parent).scrollPaddingTop) || 0)), bottom: top + element.getBoundingClientRect().height, height: parent.clientHeight, maximum: parent.scrollHeight - parent.clientHeight }
  })
  const scroller = page.locator('[data-services-capture-scroll="true"]')
  for (let offset = Math.min(bounds.top, bounds.maximum), frame = 0; ; frame++) {
    await scroller.evaluate((element, value) => { element.scrollTop = value }, offset)
    await page.screenshot({ path: info.outputPath(`${name}-${frame}.png`), animations: "disabled" })
    if (offset + bounds.height >= bounds.bottom || offset >= bounds.maximum) break
    offset = Math.min(offset + bounds.height * 0.75, bounds.maximum)
  }
}
