import { expect, test, type Page, type TestInfo } from "@playwright/test"
import { startAdministrationBackend } from "./helpers/administration-backend"
import { captureVerificationSection } from "./helpers/verification-capture"
import { captureAccessSheet } from "./helpers/administration-capture"
import { JOURNEY_WIDTH, LAYOUT_WIDTHS, viewportAt } from "./helpers/widths"

let backend: Awaited<ReturnType<typeof startAdministrationBackend>>
test.beforeAll(async () => { backend = await startAdministrationBackend() })
test.afterAll(async () => { await backend.stop() })
test.beforeEach(async ({ context }) => { await context.route("**/*", (route) => new URL(route.request().url()).origin === backend.server.baseUrl ? route.continue() : route.abort("blockedbyclient")) })
const panel = (page: Page) => page.locator('section[aria-labelledby="access-review-workspace"]')
/** The exact Google resource name, under the review's collapsed "Technical details". */
async function technicalReference(page: Page, pattern: RegExp) {
  await panel(page).getByText("Technical details", { exact: true }).click()
  await expect(panel(page).locator("details dd").filter({ hasText: pattern })).toBeVisible()
}
/** An invitation reads and sends on its own sheet; every other access change in the page panel. */
async function approveAndSend(page: Page, info: TestInfo, typedName?: string, surface: "panel" | "sheet" = "panel") {
  const review = surface === "sheet" ? page.locator('[data-slot="sheet-content"]') : panel(page)
  const shot = (name: string) => surface === "sheet" ? captureAccessSheet(page, info, name) : captureVerificationSection(page, info, { name, section: "access-review-workspace" })
  await expect(review.getByRole("button", { name: "Approve access request" })).toBeEnabled()
  await shot("review")
  await review.getByRole("button", { name: "Approve access request" }).click()
  await expect(review.getByRole("button", { name: "Send approved access request" })).toBeDisabled()
  await shot("approved")
  // A removal's send step asks for the listing name as well as the consent.
  if (typedName !== undefined) { await review.getByLabel("Type the listing name:", { exact: false }).fill(typedName); await expect(review.getByRole("button", { name: "Send approved access request" })).toBeDisabled() }
  // Tab to the consent, as a keyboard user does, rather than focus() it: each step claims focus for its title again 400 ms after it opens unless a key has been pressed, so a script that only focuses can have focus taken back between its focus() and its Space (the box then stays unticked).
  const consent = review.getByRole("checkbox")
  for (let step = 0; step < 12 && !(await consent.evaluate((element) => element === document.activeElement)); step += 1) await page.keyboard.press("Tab")
  await expect(consent).toBeFocused(); await page.keyboard.press("Space")
  await expect(consent).toBeChecked()
  await review.getByRole("button", { name: "Send approved access request" }).focus()
  await shot("keyboard-ready")
  await page.keyboard.press("Enter")
  await expect(review.getByText("Accepted by Google", { exact: true })).toBeVisible()
  await expect(review.getByText("Independently confirmed", { exact: true })).toBeVisible()
  await shot("outcome")
}
/** Invites at the exact scope on its own sheet, then restores the pending outcome: the sheet and both people panels. */
async function inviteAndRestore(page: Page, info: TestInfo, scope: "location" | "account") {
  const fixture = await backend.accessFixture(page); await fixture.open()
  await expect(page.getByText("Fixture Account Owner", { exact: true })).toBeVisible()
  await captureVerificationSection(page, info, { name: "location-admins", section: "people-location" })
  await captureVerificationSection(page, info, { name: "account-admins", section: "people-account" })
  await captureVerificationSection(page, info, { name: "lifecycle-consequences", section: "danger-zone-heading" })
  await page.getByRole("button", { name: "Invite someone" }).click()
  await captureAccessSheet(page, info, "invitation-empty")
  if (scope === "account") { await page.getByRole("combobox", { name: "Scope", exact: true }).click(); await page.getByRole("option", { name: "The whole Google account", exact: true }).click() }
  await page.getByLabel("Email address", { exact: true }).fill("invitee@example.test")
  await captureAccessSheet(page, info, "invitation-filled")
  await page.getByRole("button", { name: "Review invitation", exact: true }).click()
  expect(fixture.writes()).toHaveLength(0)
  await approveAndSend(page, info, undefined, "sheet")
  expect(fixture.writes()).toHaveLength(1)
  expect(fixture.writes()[0]).toMatchObject({ body: { admin: "invitee@example.test", role: "MANAGER" } })
  expect(fixture.writes()[0].path).toContain(`${scope === "account" ? fixture.connection.googleAccountName : fixture.linked.googleLocationName}/admins`)
  const sheet = page.locator('[data-slot="sheet-content"]')
  await expect(sheet.getByText("Google lists the invitation. They get access once they accept it.", { exact: true })).toBeVisible()
  await page.reload(); await page.getByRole("button", { name: "Open outcome", exact: true }).click()
  await expect(sheet.getByText("Independently confirmed", { exact: true })).toBeVisible()
  await captureAccessSheet(page, info, "restored")
  await sheet.getByRole("button", { name: "Back to access", exact: true }).click()
  await expect(sheet).toBeHidden()
  await captureVerificationSection(page, info, { name: "saved-work", section: "access-saved-work" })
  expect(fixture.writes()).toHaveLength(1)
}
/** A role change in the page panel: review, approval, consent and the confirmed outcome. */
async function changeRole(page: Page, info: TestInfo) {
  const fixture = await backend.accessFixture(page); await fixture.open()
  await page.getByRole("combobox", { name: "Role for manager@example.test", exact: true }).click()
  // Choosing the role saves the review: one action.
  await page.getByRole("option", { name: "Owner", exact: true }).click()
  await expect(panel(page).getByRole("heading", { name: "Review access request" })).toBeFocused()
  await expect(panel(page).locator("dl > div").filter({ has: page.getByText("Current role", { exact: true }) }).locator("dd")).toHaveText("Manager")
  await expect(panel(page).getByText("Administrator manager@example.test on this listing", { exact: true })).toBeVisible()
  await technicalReference(page, /^locations\/.+\/admins\/manager$/)
  await expect(page.getByRole("combobox", { name: "Role for manager@example.test", exact: true })).toHaveText("Manager")
  await approveAndSend(page, info)
  expect(fixture.writes()).toHaveLength(1)
  expect(fixture.state.locationAdmins[1].role).toBe("OWNER")
  await expect(page.getByRole("combobox", { name: "Role for manager@example.test", exact: true })).toHaveText("Owner")
}
test.describe(`Reviewed access journeys at ${JOURNEY_WIDTH}px`, () => {
  test.use({ viewport: viewportAt(JOURNEY_WIDTH) })
  for (const scope of ["location", "account"] as const) test(`invites at the exact ${scope} scope and restores the pending invitation outcome`, async ({ page }, info) => { await inviteAndRestore(page, info, scope) })
  test("reviews the current and proposed role before changing the exact administrator", async ({ page }, info) => { await changeRole(page, info) })
  test("reviews administrator removal and asks for the typed listing name at the send step", async ({ page }, info) => {
    const fixture = await backend.accessFixture(page); await fixture.open()
    await page.getByRole("button", { name: "Remove manager@example.test", exact: true }).click()
    await expect(panel(page).getByRole("heading", { name: "Review access request" })).toBeFocused()
    expect(fixture.writes()).toHaveLength(0)
    const [listing] = await backend.admin`select name from location where id = ${fixture.linked.locationId}`
    await approveAndSend(page, info, String(listing.name))
    await expect(panel(page).getByText("Reviewed administrator no longer listed", { exact: true })).toBeVisible()
    expect(fixture.writes()).toHaveLength(1)
  })
  for (const action of ["accept", "decline"] as const) test(`reviews and independently confirms invitation ${action}`, async ({ page }, info) => {
    const fixture = await backend.accessFixture(page); await fixture.open()
    await page.getByRole("button", { name: action === "accept" ? "Review acceptance" : "Review decline", exact: true }).click()
    expect(fixture.writes()).toHaveLength(0)
    await expect(panel(page).getByText("Pending invitation for the connected Google account", { exact: true })).toBeVisible()
    await technicalReference(page, /^accounts\/.+\/invitations\/pending$/)
    await expect(panel(page).getByText("Invited role", { exact: true })).toBeVisible()
    await expect(panel(page).getByText("Current role", { exact: true })).toHaveCount(0)
    await approveAndSend(page, info)
    await expect(panel(page).getByText(action === "accept" ? "Reviewed account and role independently accessible" : "Reviewed invitation no longer pending", { exact: true })).toBeVisible()
    expect(fixture.writes()).toHaveLength(1)
  })
})
// The two surfaces whose layout width changes: the invitation sheet with the
// people panels behind it, and the review panel a role change opens in the page.
for (const width of LAYOUT_WIDTHS) test.describe(`Reviewed access layout at ${width}px`, () => {
  test.use({ viewport: viewportAt(width) })
  test("fits the people panels and the invitation sheet", async ({ page }, info) => { await inviteAndRestore(page, info, "location") })
  test("fits the role-change review panel", async ({ page }, info) => { await changeRole(page, info) })
})
