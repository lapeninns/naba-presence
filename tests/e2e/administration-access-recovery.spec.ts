import { expect, test, type Page, type TestInfo } from "@playwright/test"
import { seedMemberUser } from "../integration/helpers/tenant"
import { startAdministrationBackend } from "./helpers/administration-backend"
import { captureVerificationSection } from "./helpers/verification-capture"

let backend: Awaited<ReturnType<typeof startAdministrationBackend>>
test.beforeAll(async () => { backend = await startAdministrationBackend() })
test.afterAll(async () => { await backend.stop() })
test.beforeEach(async ({ context }) => { await context.route("**/*", (route) => new URL(route.request().url()).origin === backend.server.baseUrl ? route.continue() : route.abort("blockedbyclient")) })
const panel = (page: Page) => page.locator('section[aria-labelledby="access-review-workspace"]')
async function reviewRole(page: Page) {
  await page.getByRole("combobox", { name: "Role for manager@example.test", exact: true }).click()
  await page.getByRole("option", { name: "Owner", exact: true }).click()
  await page.getByRole("button", { name: "Review role change", exact: true }).click()
  await expect(panel(page).getByRole("button", { name: "Approve access request" })).toBeEnabled()
}
async function send(page: Page) {
  await panel(page).getByRole("button", { name: "Approve access request" }).click()
  await panel(page).getByRole("checkbox").check()
  await panel(page).getByRole("button", { name: "Send approved access request" }).click()
}
const capture = (page: Page, info: TestInfo, name: string) => captureVerificationSection(page, info, { name, section: "access-review-workspace" })
for (const width of [375, 768, 1280]) test.describe(`Administration recovery at ${width}px`, () => {
  test.use({ viewport: { width, height: 1100 } })
  test("keeps acknowledgement unknown after independently confirming the exact applied role", async ({ page }, info) => {
    const fixture = await backend.accessFixture(page); await fixture.open(); await reviewRole(page)
    fixture.state.status = 503
    await send(page)
    await expect(panel(page).getByText("Google acknowledgement unknown", { exact: true })).toBeVisible()
    await expect(panel(page).getByText("Independently confirmed", { exact: true })).toBeVisible()
    await capture(page, info, "unknown-acknowledgement-confirmed")
    await page.reload(); await page.getByRole("button", { name: "Open outcome", exact: true }).click()
    await expect(panel(page).getByText("Google acknowledgement unknown", { exact: true })).toBeVisible()
    await panel(page).getByRole("button", { name: "Refresh Google access state" }).click()
    await expect(panel(page).getByText("Independently confirmed", { exact: true })).toBeVisible()
    expect(fixture.writes()).toHaveLength(1)
    await capture(page, info, "restored-unknown-acknowledgement")
  })
  test("blocks another action while unresolved and recovers only through reads", async ({ page }, info) => {
    const fixture = await backend.accessFixture(page); await fixture.open(); await reviewRole(page)
    fixture.state.status = 503; fixture.state.apply = false
    await send(page)
    await expect(panel(page).getByText("Outcome unresolved", { exact: true })).toBeVisible()
    await expect(panel(page).getByRole("button", { name: "Back to access" })).toBeDisabled()
    await expect(page.getByRole("button", { name: "Add administrator" })).toBeDisabled()
    await expect(page.getByRole("button", { name: "Transfer this location", exact: true })).toBeDisabled()
    await expect(page.getByRole("button", { name: "Delete this location", exact: true })).toBeDisabled()
    await capture(page, info, "unresolved")
    fixture.state.readStatus = 503
    const unavailable = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith("/execute"))
    await panel(page).getByRole("button", { name: "Refresh Google access state" }).click()
    expect((await unavailable).status()).toBe(200)
    await expect(panel(page).getByText(/previous observation is retained/)).toBeVisible()
    await capture(page, info, "refresh-unavailable")
    fixture.state.readStatus = 200; fixture.state.locationAdmins[1].role = "OWNER"
    const refreshed = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith("/execute"))
    await panel(page).getByRole("button", { name: "Refresh Google access state" }).click()
    expect((await refreshed).status()).toBe(200)
    await expect(panel(page).getByText("Independently confirmed", { exact: true })).toBeVisible()
    await capture(page, info, "recovered")
    expect(fixture.writes()).toHaveLength(1)
  })
  test("blocks baseline drift after approval and clears consent on reopening the saved review", async ({ page }, info) => {
    const fixture = await backend.accessFixture(page); await fixture.open(); await reviewRole(page)
    await panel(page).getByRole("button", { name: "Approve access request" }).click()
    await panel(page).getByRole("checkbox").check()
    await page.getByRole("button", { name: "Open review", exact: true }).click()
    await expect(panel(page).getByRole("checkbox")).not.toBeChecked()
    fixture.state.locationAdmins[1].admin = "changed@example.test"
    await panel(page).getByRole("checkbox").check()
    await panel(page).getByRole("button", { name: "Send approved access request" }).click()
    await expect(panel(page).getByText("This review cannot be sent. Check current Google state and create a fresh review.", { exact: true })).toBeVisible()
    await expect(panel(page).getByRole("button", { name: "Send approved access request" })).toHaveCount(0)
    await expect(panel(page).getByRole("button", { name: "Back to access" })).toBeEnabled()
    expect(fixture.writes()).toHaveLength(0)
    await capture(page, info, "baseline-stale")
  })
  test("restores a second-manager approval and checks their current access before sending", async ({ page }, info) => {
    const fixture = await backend.accessFixture(page)
    await backend.admin`update organisation set require_two_person_approval = true where id = ${fixture.owner.organisationId}`
    const manager = await seedMemberUser(backend.admin, { organisationId: fixture.owner.organisationId })
    await backend.admin`update member set role = 'admin' where organisation_id = ${fixture.owner.organisationId} and user_id = ${manager.userId}`
    await fixture.open(); await page.getByRole("combobox", { name: "Role for manager@example.test", exact: true }).click(); await page.getByRole("option", { name: "Owner", exact: true }).click(); await page.getByRole("button", { name: "Review role change" }).click()
    await expect(panel(page).getByRole("button", { name: "Approve access request" })).toBeDisabled()
    await capture(page, info, "second-manager-required")
    await page.context().clearCookies(); await page.context().addCookies([{ name: "naba_session", value: manager.cookie.slice("naba_session=".length), url: backend.server.baseUrl }]); await page.reload()
    await page.getByRole("button", { name: "Open review", exact: true }).click(); await panel(page).getByRole("button", { name: "Approve access request" }).click()
    await expect(panel(page).getByRole("checkbox")).not.toBeChecked()
    await capture(page, info, "manager-approved")
    await page.context().clearCookies(); await page.context().addCookies([{ name: "naba_session", value: fixture.owner.cookie.slice("naba_session=".length), url: backend.server.baseUrl }]); await page.reload(); await page.getByRole("button", { name: "Open review", exact: true }).click()
    await expect(panel(page).getByRole("checkbox")).not.toBeChecked()
    await backend.admin`update member set role = 'viewer' where organisation_id = ${fixture.owner.organisationId} and user_id = ${manager.userId}`
    await panel(page).getByRole("checkbox").check(); await panel(page).getByRole("button", { name: "Send approved access request" }).click()
    await expect(panel(page).getByText(/This review cannot be sent/)).toBeVisible()
    expect(fixture.writes()).toHaveLength(0)
    await capture(page, info, "manager-revoked")
  })
})
