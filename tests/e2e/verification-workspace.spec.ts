import { expect, test, type Page, type TestInfo } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { setupVerificationWorkspace } from "./helpers/verification-workspace"

async function captureWorkspace(page: Page, info: TestInfo, name: string) {
  expect((await new AxeBuilder({ page }).include('section[aria-labelledby^="verification-"]').analyze()).violations).toEqual([])
  // Every inner pane that overflows (desk: the shell's column and the
  // workspace panes), plus the document itself, which is what scrolls on a
  // phone (components/app-shell/app-shell.tsx). The document is marked -1
  // and driven through window.scrollTo.
  const scrollers = await page.evaluate(() => {
    const panes = Array.from(document.querySelectorAll<HTMLElement>("body *")).filter((element) => ["auto", "scroll"].includes(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 1).map((element, index) => {
      element.dataset.verificationCaptureScroll = String(index)
      element.scrollTo({ top: 0, behavior: "instant" })
      return { index, height: element.clientHeight, extent: element.scrollHeight - element.clientHeight }
    })
    const root = (document.scrollingElement ?? document.documentElement) as HTMLElement
    window.scrollTo({ top: 0, behavior: "instant" })
    if (root.scrollHeight <= root.clientHeight + 1) return panes
    const style = getComputedStyle(document.documentElement)
    const covered = (Number.parseFloat(style.scrollPaddingTop) || 0) + (Number.parseFloat(style.scrollPaddingBottom) || 0)
    return [...panes, { index: -1, height: Math.max(1, root.clientHeight - covered), extent: root.scrollHeight - root.clientHeight }]
  })
  const scrollTo = (index: number, top: number) =>
    index === -1
      ? page.evaluate((value) => window.scrollTo({ top: value, behavior: "instant" }), top)
      : page.locator(`[data-verification-capture-scroll="${index}"]`).evaluate((element, value) => element.scrollTo({ top: value, behavior: "instant" }), top)
  await page.screenshot({ path: info.outputPath(`${name}-top.png`), animations: "disabled" })
  for (const scroller of scrollers) {
    const label = scroller.index === -1 ? "document" : String(scroller.index)
    for (let offset = Math.min(scroller.height * 0.75, scroller.extent), frame = 1; ; offset = Math.min(offset + scroller.height * 0.75, scroller.extent), frame += 1) {
      await scrollTo(scroller.index, offset)
      await page.screenshot({ path: info.outputPath(`${name}-scroll-${label}-${frame}.png`), animations: "disabled" })
      if (offset === scroller.extent) break
    }
    await scrollTo(scroller.index, 0)
  }
}

for (const width of [375, 768, 1280]) {
  test(`reviewed PIN completion, keyboard consent and saved outcome at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1100 })
    const fixture = await setupVerificationWorkspace(page); await fixture.open()
    await expect(page.getByText("Merchant standing is unknown", { exact: true })).toBeVisible()
    await expect(page.getByText("Not verified", { exact: true })).toHaveCount(0)
    const panel = page.locator('section[aria-labelledby="verification-pin"]')
    await captureWorkspace(page, info, `verification-pending-${width}`)
    await panel.getByLabel("PIN from Google").fill("001234")
    await panel.getByRole("button", { name: "Review PIN completion" }).click()
    await expect(panel.getByLabel("PIN from Google")).toHaveCount(0)
    await captureWorkspace(page, info, `verification-review-${width}`)
    await panel.getByRole("button", { name: "Approve PIN completion" }).click()
    const pin = panel.getByLabel("Re-enter reviewed PIN")
    await expect(pin).toHaveValue("")
    await expect(panel.getByRole("button", { name: "Send approved PIN" })).toBeDisabled()
    await captureWorkspace(page, info, `verification-approved-${width}`)
    await pin.fill("001234")
    await panel.getByRole("checkbox").focus(); await page.keyboard.press("Space")
    await panel.getByRole("button", { name: "Send approved PIN" }).focus(); await page.keyboard.press("Enter")
    await expect(panel.getByText("Accepted by Google", { exact: true })).toBeVisible()
    await expect(panel.getByText("Independent confirmation unresolved", { exact: true })).toBeVisible()
    expect(await page.evaluate(() => `${location.href} ${JSON.stringify(localStorage)} ${JSON.stringify(sessionStorage)}`)).not.toContain("001234")
    await captureWorkspace(page, info, `verification-outcome-${width}`)
    expect((await new AxeBuilder({ page }).include('section[aria-labelledby="verification-pin"]').analyze()).violations).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.reload()
    await panel.getByRole("button", { name: "Open saved outcome" }).click()
    await expect(panel.getByText("Independent confirmation unresolved", { exact: true })).toBeVisible()
    expect(fixture.read()).toEqual({ executions: 1, previews: 1, legacyRequests: 0 })
  })

  test(`recovers a lost PIN response while disconnected at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1100 })
    const fixture = await setupVerificationWorkspace(page); await fixture.open()
    const panel = page.locator('section[aria-labelledby="verification-pin"]')
    await panel.getByLabel("PIN from Google").fill("001234")
    await panel.getByRole("button", { name: "Review PIN completion" }).click()
    await panel.getByRole("button", { name: "Approve PIN completion" }).click()
    await panel.getByLabel("Re-enter reviewed PIN").fill("001234")
    await panel.getByRole("checkbox").check()
    fixture.loseExecutionResponse()
    await panel.getByRole("button", { name: "Send approved PIN" }).click()
    await expect(panel.getByRole("button", { name: "Send approved PIN" })).toHaveCount(0)
    fixture.disconnect(); await page.reload()
    await expect(page.getByText("Current Google state could not be read", { exact: true })).toBeVisible()
    await expect(page.getByText("Not verified", { exact: true })).toHaveCount(0)
    await panel.getByRole("button", { name: "Open saved outcome" }).click()
    await expect(panel.getByText("Accepted by Google", { exact: true })).toBeVisible()
    await expect(panel.getByText("Independent confirmation unresolved", { exact: true })).toBeVisible()
    await captureWorkspace(page, info, `verification-disconnected-${width}`)
    expect((await new AxeBuilder({ page }).include('section[aria-labelledby="verification-pin"]').analyze()).violations).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(fixture.read()).toEqual({ executions: 1, previews: 1, legacyRequests: 0 })
  })
}
