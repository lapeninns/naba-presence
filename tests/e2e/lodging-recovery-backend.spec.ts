import { expect, test, type Page } from "@playwright/test"
import { startLodgingBackend } from "./helpers/lodging-backend"
import { captureLodgingDialog, lodgingEditor } from "./helpers/lodging-capture"

let backend: Awaited<ReturnType<typeof startLodgingBackend>>
test.beforeAll(async () => { backend = await startLodgingBackend() })
test.afterAll(async () => { await backend.stop() })
test.beforeEach(async ({ context }) => { await context.route("**/*", (route) => new URL(route.request().url()).origin === backend.server.baseUrl ? route.continue() : route.abort("blockedbyclient")) })
async function approved(page: Page) {
  const fixture = await backend.lodgingFixture(page); await fixture.open()
  await lodgingEditor(page).getByRole("searchbox", { name: "Find a lodging detail" }).fill("Pets allowed")
  await lodgingEditor(page).getByRole("combobox", { name: "Pets allowed", exact: true }).click()
  await page.getByRole("option", { name: "Yes", exact: true }).click()
  await page.getByRole("button", { name: "Review lodging changes", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Review changes" })
  await dialog.getByRole("button", { name: "Approve lodging changes", exact: true }).click()
  await dialog.getByRole("checkbox", { name: "Send these exact approved lodging changes to Google." }).check()
  return { fixture, dialog }
}
for (const width of [375, 768, 1280]) test.describe(`Lodging recovery at ${width}px`, () => {
  test.use({ viewport: { width, height: 1100 } })
  test("rejects baseline drift before a Google write", async ({ page }, info) => {
    const { fixture, dialog } = await approved(page)
    fixture.state.lodging.property = { roomsCount: 999, floorsCount: 0 }
    await dialog.getByRole("button", { name: "Send approved lodging changes", exact: true }).click()
    await expect(dialog.getByRole("alert")).toBeVisible()
    await expect(dialog.getByText("This review needs a fresh preview before sending.", { exact: true })).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Send approved lodging changes", exact: true })).toBeDisabled()
    await captureLodgingDialog(page, info, "baseline-drift")
    expect(fixture.writes()).toHaveLength(0)
  })
  test("reads a lost browser acknowledgement without replaying the accepted provider request", async ({ page }, info) => {
    const { fixture, dialog } = await approved(page)
    let intercepted = false
    await page.route(`**/api/locations/${fixture.linked.locationId}/industry`, async (route) => {
      if (route.request().method() !== "PATCH") return route.continue()
      await route.fetch(); intercepted = true; await route.abort("failed")
    })
    await dialog.getByRole("button", { name: "Send approved lodging changes", exact: true }).click()
    await expect.poll(() => intercepted).toBe(true)
    await expect(dialog.getByText("The send response is unavailable. Read the saved outcome before another write.", { exact: true })).toBeVisible()
    await captureLodgingDialog(page, info, "lost-response")
    await dialog.getByRole("button", { name: "Read saved lodging outcome", exact: true }).click()
    await expect(dialog.getByText("Accepted by Google", { exact: true })).toBeVisible()
    await expect(dialog.getByText("Independently confirmed", { exact: true })).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Send approved lodging changes", exact: true })).toHaveCount(0)
    await captureLodgingDialog(page, info, "saved-confirmation")
    expect(fixture.writes()).toHaveLength(1)
  })
  test("keeps an accepted but unconfirmed request unresolved until a separate observation", async ({ page }, info) => {
    const { fixture, dialog } = await approved(page)
    fixture.state.apply = false
    await dialog.getByRole("button", { name: "Send approved lodging changes", exact: true }).click()
    await expect(dialog.getByText("Accepted by Google", { exact: true })).toBeVisible()
    await expect(dialog.getByText("Independent confirmation unresolved", { exact: true })).toBeVisible()
    const inactiveToast = page.locator('[data-base-ui-inert] [data-slot="toast"]').filter({ hasText: "Google confirmation is unresolved." })
    await expect(inactiveToast).toHaveCSS("pointer-events", "none")
    await captureLodgingDialog(page, info, "accepted-unresolved")
    fixture.applyLastWrite()
    await dialog.getByRole("button", { name: "Refresh lodging observation", exact: true }).click()
    await expect(dialog.getByText("Independently confirmed", { exact: true })).toBeVisible()
    await captureLodgingDialog(page, info, "separate-observation")
    expect(fixture.writes()).toHaveLength(1)
  })
})
