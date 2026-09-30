import { expect, test, type Page, type TestInfo } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { startServicesBackend } from "./helpers/services-backend"
import { captureServicesPanel } from "./helpers/services-capture"

let backend: Awaited<ReturnType<typeof startServicesBackend>>
test.beforeAll(async () => { backend = await startServicesBackend() })
test.afterAll(async () => { await backend.stop() })
test.beforeEach(async ({ context }) => { await context.route("**/*", (route) => new URL(route.request().url()).origin === backend.server.baseUrl ? route.continue() : route.abort("blockedbyclient")) })
async function capture(page: Page, info: TestInfo, name: string) {
  const dialogVisible = await page.getByRole("dialog").isVisible()
  expect((await new AxeBuilder({ page }).include(dialogVisible ? '[role="dialog"]' : '#section-services').analyze()).violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath(`${name}.png`), animations: "disabled" })
}
async function review(page: Page) {
  await page.locator("#section-services").getByRole("textbox", { name: "Description", exact: true }).fill("Follow-up appointment")
  await page.getByRole("button", { name: "Review service changes", exact: true }).click()
  return page.getByRole("dialog", { name: serviceSheet })
}
// The sheet is titled as a review until a request is recorded, then as its outcome.
const serviceSheet = /^(Review service changes|Saved service outcome)$/
for (const width of [375, 768, 1280]) test.describe(`Healthcare general services at ${width}px`, () => {
  test.use({ viewport: { width, height: 1100 } })
  test("shows provider category attributes and an explicit retail product handoff without a food-menu substitute", async ({ page }, info) => {
    const fixture = await backend.serviceFixture(page, "retail"); await fixture.open()
    const pickup = page.getByRole("switch", { name: "In-store pickup", exact: true })
    await expect(pickup).toBeEnabled(); await expect(pickup).not.toBeChecked()
    await captureServicesPanel(page, info, "retail-attributes", "#section-attributes")
    await pickup.check()
    await captureServicesPanel(page, info, "retail-attribute-draft", "#section-attributes")
    expect(fixture.writes()).toHaveLength(0)
    const handoff = page.getByRole("region", { name: "Product catalogue", exact: true })
    await handoff.scrollIntoViewIfNeeded()
    await expect(handoff.getByRole("link", { name: "Manage retail products in Google", exact: true })).toHaveAttribute("href", "https://business.google.com/")
    await expect(handoff.getByRole("button")).toHaveCount(0)
    expect((await new AxeBuilder({ page }).include("#section-retail-products").analyze()).violations).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath("retail-google-handoff.png"), animations: "disabled" })
    expect(backend.google.calls.some((call) => call.path.includes("foodMenus"))).toBe(false)
  })
  test("reviews, approves and sends exact general services with independently dated recovery", async ({ page }, info) => {
    const fixture = await backend.serviceFixture(page); await fixture.open()
    await expect(page.getByRole("textbox", { name: "Service name", exact: true })).toHaveValue("Consultation")
    await expect(page.getByText("Healthcare services", { exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Add custom service for Doctor", exact: true })).toBeEnabled()
    await captureServicesPanel(page, info, "general-editor")
    const dialog = await review(page)
    await expect(dialog.getByText(/Follow-up appointment/)).toBeVisible()
    await capture(page, info, "review")
    expect(fixture.writes()).toHaveLength(0)
    await dialog.getByRole("button", { name: "Approve service changes", exact: true }).click()
    expect(fixture.writes()).toHaveLength(0)
    await expect(dialog.getByRole("button", { name: "Send approved service changes", exact: true })).toBeDisabled()
    await dialog.getByRole("checkbox", { name: "Send these exact approved service changes to Google." }).check()
    await capture(page, info, "consent")
    await dialog.getByRole("button", { name: "Send approved service changes", exact: true }).click()
    await expect(dialog.getByText("Independently confirmed", { exact: true })).toBeVisible()
    await expect(dialog.locator("time").last()).toBeVisible()
    expect(fixture.writes()).toHaveLength(1)
    expect(fixture.state.items[0]).toMatchObject({ price: { currencyCode: "GBP", units: "35", nanos: 500000000 }, freeFormServiceItem: { label: { description: "Follow-up appointment" } } })
    await capture(page, info, "confirmed")
  })
  test("blocks changed service eligibility before a provider write", async ({ page }, info) => {
    const fixture = await backend.serviceFixture(page); await fixture.open()
    const dialog = await review(page)
    await dialog.getByRole("button", { name: "Approve service changes", exact: true }).click()
    await dialog.getByRole("checkbox").check()
    fixture.state.eligible = false
    await dialog.getByRole("button", { name: "Send approved service changes", exact: true }).click()
    await expect(dialog.getByRole("alert")).toBeVisible()
    expect(fixture.writes()).toHaveLength(0)
    await capture(page, info, "eligibility-drift")
  })
  test("recovers a lost response and discovers the saved outcome after disconnection without replay", async ({ page }, info) => {
    const fixture = await backend.serviceFixture(page); await fixture.open()
    const dialog = await review(page)
    await dialog.getByRole("button", { name: "Approve service changes", exact: true }).click()
    await dialog.getByRole("checkbox").check()
    let intercepted = false
    await page.route(`**/api/locations/${fixture.linked.locationId}/business-information`, async (route) => {
      if (route.request().method() === "PATCH" && !intercepted) { intercepted = true; await route.fetch(); await route.abort("failed") }
      else await route.continue()
    })
    await dialog.getByRole("button", { name: "Send approved service changes", exact: true }).click()
    await expect(dialog.getByText(/The send response is unavailable/)).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Send approved service changes", exact: true })).toHaveCount(0)
    await expect(dialog.getByRole("button", { name: "Read saved service outcome", exact: true })).toBeEnabled()
    await expect(dialog.getByRole("button", { name: "Keep editing", exact: true })).toBeEnabled()
    await capture(page, info, "lost-response")
    await dialog.getByRole("button", { name: "Read saved service outcome", exact: true }).click()
    await expect(dialog.getByText("Independently confirmed", { exact: true })).toBeVisible()
    expect(fixture.writes()).toHaveLength(1)
    await fixture.disconnect(); await page.reload()
    await expect(page.getByRole("region", { name: "Saved service work", exact: true }).getByRole("button", { name: "Open service outcome", exact: true })).toBeVisible()
    await expect(page.getByRole("region", { name: "Saved service work", exact: true }).getByText(/^Services for /).first()).toBeVisible()
    await captureServicesPanel(page, info, "disconnected-index", 'section[aria-label="Saved service work"]')
    await page.getByRole("region", { name: "Saved service work", exact: true }).getByRole("button", { name: "Open service outcome", exact: true }).click()
    const restored = page.getByRole("dialog", { name: "Saved service outcome" })
    await expect(restored.getByText("Independently confirmed", { exact: true })).toBeVisible()
    await expect(restored.getByRole("button", { name: "Send approved service changes", exact: true })).toHaveCount(0)
    await expect(restored.getByText(/fresh preview|Approval expired/)).toHaveCount(0)
    expect(fixture.writes()).toHaveLength(1)
    await capture(page, info, "disconnected-saved")
  })
  test("keeps an unresolved provider observation blocked until a separate read confirms the exact services", async ({ page }, info) => {
    const fixture = await backend.serviceFixture(page); fixture.state.status = 503; fixture.state.apply = false
    await fixture.open()
    const dialog = await review(page)
    await dialog.getByRole("button", { name: "Approve service changes", exact: true }).click()
    await dialog.getByRole("checkbox").check()
    await dialog.getByRole("button", { name: "Send approved service changes", exact: true }).click()
    await expect(dialog.getByText("Independent confirmation unresolved", { exact: true })).toBeVisible()
    await expect(dialog.getByText("Google acknowledgement unknown", { exact: true })).toBeVisible()
    expect(fixture.writes()).toHaveLength(1)
    await capture(page, info, "unresolved")
    const item = fixture.state.items[0]
    if (!item || !("freeFormServiceItem" in item)) throw new Error("Healthcare fixture service missing")
    fixture.state.items = [{ ...item, freeFormServiceItem: { ...item.freeFormServiceItem, label: { ...item.freeFormServiceItem.label, description: "Follow-up appointment" } } }]
    await dialog.getByRole("button", { name: "Refresh service observation", exact: true }).click()
    await expect(dialog.getByText("Independently confirmed", { exact: true })).toBeVisible()
    await expect(dialog.getByText("Google acknowledgement unknown", { exact: true })).toBeVisible()
    expect(fixture.writes()).toHaveLength(1)
    await capture(page, info, "separate-observation")
  })
})
