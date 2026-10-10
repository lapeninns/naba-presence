import { expect, test, type Page, type TestInfo } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { setupVerificationWorkspace } from "./helpers/verification-workspace"

async function captureWorkspace(page: Page, info: TestInfo, name: string) {
  expect((await new AxeBuilder({ page }).include('section[aria-labelledby^="verification-"]').analyze()).violations).toEqual([])
  const scrollers = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("body *")).filter((element) => ["auto", "scroll"].includes(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 1).map((element, index) => {
    element.dataset.verificationCaptureScroll = String(index)
    element.scrollTop = 0
    return { index, height: element.clientHeight, extent: element.scrollHeight - element.clientHeight }
  }))
  await page.screenshot({ path: info.outputPath(`${name}-top.png`), animations: "disabled" })
  for (const scroller of scrollers) {
    for (let offset = Math.min(scroller.height * 0.75, scroller.extent), frame = 1; ; offset = Math.min(offset + scroller.height * 0.75, scroller.extent), frame += 1) {
      await page.locator(`[data-verification-capture-scroll="${scroller.index}"]`).evaluate((element, top) => { element.scrollTop = top }, offset)
      await page.screenshot({ path: info.outputPath(`${name}-scroll-${scroller.index}-${frame}.png`), animations: "disabled" })
      if (offset === scroller.extent) break
    }
    await page.locator(`[data-verification-capture-scroll="${scroller.index}"]`).evaluate((element) => { element.scrollTop = 0 })
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
    await expect(panel.getByText("Google accepted the request", { exact: true })).toBeVisible()
    await expect(panel.getByText("Confirmation unresolved", { exact: true })).toBeVisible()
    expect(await page.evaluate(() => `${location.href} ${JSON.stringify(localStorage)} ${JSON.stringify(sessionStorage)}`)).not.toContain("001234")
    await captureWorkspace(page, info, `verification-outcome-${width}`)
    expect((await new AxeBuilder({ page }).include('section[aria-labelledby="verification-pin"]').analyze()).violations).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.reload()
    await panel.getByRole("button", { name: "Open saved outcome" }).click()
    await expect(panel.getByText("Confirmation unresolved", { exact: true })).toBeVisible()
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
    await expect(panel.getByText("Google accepted the request", { exact: true })).toBeVisible()
    await expect(panel.getByText("Confirmation unresolved", { exact: true })).toBeVisible()
    await captureWorkspace(page, info, `verification-disconnected-${width}`)
    expect((await new AxeBuilder({ page }).include('section[aria-labelledby="verification-pin"]').analyze()).violations).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(fixture.read()).toEqual({ executions: 1, previews: 1, legacyRequests: 0 })
  })
}
