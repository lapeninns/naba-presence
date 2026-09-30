import { expect, test, type Page, type TestInfo } from "@playwright/test"
import { startLifecycleBackend } from "./helpers/lifecycle-backend"
import { captureVerificationSection } from "./helpers/verification-capture"
import { captureAccessDialog } from "./helpers/administration-capture"

let backend: Awaited<ReturnType<typeof startLifecycleBackend>>
test.beforeAll(async () => { backend = await startLifecycleBackend() })
test.afterAll(async () => { await backend.stop() })
test.beforeEach(async ({ context }) => { await context.route("**/*", (route) => new URL(route.request().url()).origin === backend.server.baseUrl ? route.continue() : route.abort("blockedbyclient")) })
const reviewPanel = (page: Page) => page.locator('section[aria-labelledby="lifecycle-review-title"]')
const outcomePanel = (page: Page) => page.locator('section[aria-labelledby="lifecycle-outcome-title"]')
async function prepare(page: Page, fixture: Awaited<ReturnType<typeof backend.lifecycleFixture>>, transfer: boolean, info: TestInfo) {
  await fixture.open()
  await expect(page.getByText("Fixture Account Owner", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: transfer ? "Transfer this location" : "Delete this location", exact: true }).click()
  if (transfer) await page.getByLabel("Destination Google account").fill(fixture.destinationAccount)
  await captureAccessDialog(page, info, "prepare-lifecycle")
  await page.getByRole("button", { name: transfer ? "Continue to transfer review" : "Prepare deletion review", exact: true }).click()
  await expect(reviewPanel(page)).toBeVisible()
  expect(fixture.lifecycleWrites()).toHaveLength(0)
  await captureVerificationSection(page, info, { name: "exact-review", section: "lifecycle-review-title" })
  await reviewPanel(page).getByRole("button", { name: "Approve lifecycle request" }).click()
  const send = reviewPanel(page).getByRole("button", { name: transfer ? "Send approved transfer" : "Send approved deletion" })
  await expect(send).toBeDisabled()
  await reviewPanel(page).getByLabel("Type the listing name:", { exact: false }).fill(fixture.locationName)
  await expect(send).toBeDisabled()
  expect(fixture.lifecycleWrites()).toHaveLength(0)
  await reviewPanel(page).getByRole("checkbox").focus(); await page.keyboard.press("Space")
  await expect(send).toBeEnabled(); await send.focus()
  await captureVerificationSection(page, info, { name: "approved-keyboard-consent", section: "lifecycle-review-title" })
  return send
}
for (const width of [375, 768, 1280]) test.describe(`Lifecycle at ${width}px`, () => {
  test.use({ viewport: { width, height: 1100 } })
  for (const transfer of [true, false]) test(`separate review, approval and ${transfer ? "transfer" : "deletion"} send with saved recovery`, async ({ page }, info) => {
    const fixture = await backend.lifecycleFixture(page)
    await prepare(page, fixture, transfer, info); await page.keyboard.press("Enter")
    await expect(outcomePanel(page).getByText("Accepted by Google", { exact: true })).toBeVisible()
    await expect(outcomePanel(page).getByText("Independently confirmed", { exact: true })).toBeVisible()
    expect(fixture.lifecycleWrites()).toHaveLength(1)
    if (transfer) {
      expect(fixture.lifecycleWrites()[0].body).toEqual({ destinationAccount: fixture.destinationAccount })
      await expect(outcomePanel(page).getByText("NabaPresence is linked to the independently confirmed destination account.")).toBeVisible()
    } else await expect(outcomePanel(page).getByText("Search/Maps removal and customer-review deletion are not confirmed.", { exact: false })).toBeVisible()
    await captureVerificationSection(page, info, { name: "confirmed-outcome", section: "lifecycle-outcome-title" })
    await fixture.disconnect(); await page.reload()
    await page.getByRole("button", { name: "Open lifecycle outcome", exact: true }).click()
    await expect(outcomePanel(page).getByText("Independently confirmed", { exact: true })).toBeVisible()
    await captureVerificationSection(page, info, { name: "disconnected-saved-outcome", section: "lifecycle-outcome-title" })
    expect(fixture.lifecycleWrites()).toHaveLength(1)
  })
  test("accepted deletion with forbidden read stays unresolved until independent recovery", async ({ page }, info) => {
    const fixture = await backend.lifecycleFixture(page); fixture.lifecycleState.afterDeleteStatus = 403
    const send = await prepare(page, fixture, false, info); await send.click()
    await expect(outcomePanel(page).getByText("Accepted by Google", { exact: true })).toBeVisible()
    await expect(outcomePanel(page).getByText("Independent confirmation unresolved", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Transfer this location", exact: true })).toBeDisabled()
    await expect(page.getByRole("button", { name: "Add administrator", exact: true })).toBeDisabled()
    await expect(outcomePanel(page).getByRole("button", { name: "Review another lifecycle action" })).toBeDisabled()
    await captureVerificationSection(page, info, { name: "forbidden-unresolved", section: "lifecycle-outcome-title" })
    fixture.lifecycleState.locationStatus = 404
    await outcomePanel(page).getByRole("button", { name: "Refresh lifecycle observation" }).click()
    await expect(outcomePanel(page).getByText("Independently confirmed", { exact: true })).toBeVisible()
    expect(fixture.lifecycleWrites()).toHaveLength(1)
    await captureVerificationSection(page, info, { name: "separate-read-recovered", section: "lifecycle-outcome-title" })
  })
  test("keeps transfer acknowledgement unknown after an independently confirmed applied write", async ({ page }, info) => {
    const fixture = await backend.lifecycleFixture(page); fixture.lifecycleState.writeStatus = 503
    const send = await prepare(page, fixture, true, info); await send.click()
    await expect(outcomePanel(page).getByText("Google acknowledgement unknown", { exact: true })).toBeVisible()
    await expect(outcomePanel(page).getByText("Independently confirmed", { exact: true })).toBeVisible()
    await expect(outcomePanel(page).getByText("NabaPresence is linked to the independently confirmed destination account.")).toBeVisible()
    expect(fixture.lifecycleWrites()).toHaveLength(1)
    await captureVerificationSection(page, info, { name: "unknown-ack-confirmed-transfer", section: "lifecycle-outcome-title" })
  })
  test("blocks destination role drift after approval without sending", async ({ page }, info) => {
    const fixture = await backend.lifecycleFixture(page), send = await prepare(page, fixture, true, info)
    fixture.lifecycleState.destinationRole = "SITE_MANAGER"; await send.click()
    await expect(reviewPanel(page).getByText("Create a fresh lifecycle review before sending.")).toBeVisible()
    await expect(send).toBeDisabled(); expect(fixture.lifecycleWrites()).toHaveLength(0)
    await captureVerificationSection(page, info, { name: "destination-drift-blocked", section: "lifecycle-review-title" })
  })
  test("restores a lost lifecycle response from the database without a resend", async ({ page }, info) => {
    const fixture = await backend.lifecycleFixture(page), send = await prepare(page, fixture, false, info)
    await page.route("**/administration-lifecycle-reviews/*/execute", async (route) => {
      if (route.request().method() !== "POST") return route.continue()
      const result = await route.fetch(); expect(result.status()).toBe(200); await route.abort("connectionfailed")
    })
    await send.click()
    await expect(reviewPanel(page).getByText("The send response is unavailable. Read the saved outcome before another lifecycle write.")).toBeVisible()
    await captureVerificationSection(page, info, { name: "lost-response-guarded", section: "lifecycle-review-title" })
    await reviewPanel(page).getByRole("button", { name: "Read saved lifecycle outcome" }).click()
    await expect(outcomePanel(page).getByText("Independently confirmed", { exact: true })).toBeVisible()
    expect(fixture.lifecycleWrites()).toHaveLength(1)
    await captureVerificationSection(page, info, { name: "lost-response-restored", section: "lifecycle-outcome-title" })
  })
  test("blocks expired approval before a provider write", async ({ page }, info) => {
    const fixture = await backend.lifecycleFixture(page), send = await prepare(page, fixture, false, info)
    const reviewId = await fixture.reviewId("location_lifecycle")
    await backend.admin`update gbp_change_set set approval_expires_at = now() - interval '1 hour' where id = ${reviewId}`
    await send.click(); await expect(reviewPanel(page).getByText("Create a fresh lifecycle review before sending.")).toBeVisible()
    expect(fixture.lifecycleWrites()).toHaveLength(0)
    await captureVerificationSection(page, info, { name: "expired-approval-blocked", section: "lifecycle-review-title" })
  })
})
