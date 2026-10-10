import { expect, test } from "@playwright/test"
import { startVerificationBackend } from "./helpers/verification-backend"
import { approvePin, assertPinPrivacy, capturePin, sendPin, type VerificationBackend } from "./helpers/verification-pin-backend"

let backend: VerificationBackend
test.beforeAll(async () => { backend = await startVerificationBackend() })
test.afterAll(async () => { await backend.stop() })
test.beforeEach(async ({ context }) => {
  await context.route("**/*", (route) => new URL(route.request().url()).origin === backend.server.baseUrl ? route.continue() : route.abort("blockedbyclient"))
})
for (const width of [375, 768, 1280]) {
  test.describe(`PIN drift at ${width}px`, () => {
    test.use({ viewport: { width, height: 1100 } })
    for (const kind of ["expiry", "policy", "generation", "target", "phase", "pin"] as const) {
      test(`requires a fresh review after ${kind} changes without a provider send`, async ({ page }, info) => {
        const fixture = await backend.fixture(page, "SMS", true); await fixture.open()
        const panel = await approvePin(page), reviewId = await fixture.reviewId("verification_complete")
        switch (kind) {
          case "expiry": await backend.admin`update gbp_change_set set approval_expires_at = now() - interval '1 minute' where id = ${reviewId}`; break
          case "policy": await backend.admin`update organisation set require_two_person_approval = true where id = ${fixture.owner.organisationId}`; break
          case "generation": await backend.admin`update google_connection set credential_generation = credential_generation + 1 where id = ${fixture.connection.connectionId}`; break
          case "target": await backend.admin`update external_location set google_location_name = 'locations/relinked-fixture' where id = ${fixture.linked.externalLocationId}`; break
          case "phase": fixture.setPhase("COMPLETED"); break
          case "pin": break
        }
        await sendPin(page, kind === "pin" ? "009999" : "001234")
        await expect(panel.getByRole("button", { name: "Send approved PIN" })).toHaveCount(0)
        await expect(panel.getByRole("alert").first()).toBeVisible()
        expect(fixture.completionWrites()).toHaveLength(0)
        expect(await backend.admin`select id from gbp_management_mutation where change_set_id = ${reviewId}`).toHaveLength(0)
        await capturePin(page, info, `blocked-${kind}`)
        await panel.getByRole("button", { name: "Create a fresh PIN review" }).click()
        await expect(panel.getByRole("heading", { name: "Review PIN completion" })).toHaveCount(0)
        await assertPinPrivacy(backend, fixture)
      })
    }
    test("checks authoritative expiry before discarding an uncertain request with no durable attempt", async ({ page }, info) => {
      const fixture = await backend.fixture(page, "EMAIL", true); await fixture.open()
      const panel = await approvePin(page), reviewId = await fixture.reviewId("verification_complete")
      await backend.admin`update gbp_change_set set approval_expires_at = now() - interval '1 minute' where id = ${reviewId}`
      const execute = `**/verification-completion-reviews/${reviewId}/execute`
      await page.route(execute, (route) => route.request().method() === "POST" ? route.abort("failed") : route.continue())
      await sendPin(page)
      await expect(panel.getByText(/send response was unavailable/)).toBeVisible()
      await page.unroute(execute)
      await panel.getByRole("button", { name: "Check saved PIN outcome" }).click()
      await expect(panel.getByRole("button", { name: "Send approved PIN" })).toHaveCount(0)
      await expect(panel.getByRole("button", { name: "Create a fresh PIN review" })).toBeEnabled()
      await capturePin(page, info, "absent-expired-recovery")
      await panel.getByRole("button", { name: "Create a fresh PIN review" }).click()
      await expect(panel.getByLabel("PIN from Google")).toHaveValue("")
      expect(fixture.completionWrites()).toHaveLength(0)
    })
  })
}
