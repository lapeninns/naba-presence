import { expect, test } from "@playwright/test"
import { startVerificationBackend } from "./helpers/verification-backend"
import { approvePin, assertPinPrivacy, capturePin, pinPanel, previewPin, reviewedPin, sendPin, type VerificationBackend } from "./helpers/verification-pin-backend"
import { seedMemberUser } from "../integration/helpers/tenant"

let backend: VerificationBackend
test.beforeAll(async () => { backend = await startVerificationBackend() })
test.afterAll(async () => { await backend.stop() })
test.beforeEach(async ({ context }) => {
  await context.route("**/*", (route) => new URL(route.request().url()).origin === backend.server.baseUrl ? route.continue() : route.abort("blockedbyclient"))
})
for (const width of [375, 768, 1280]) {
  test.describe(`PIN recovery at ${width}px`, () => {
    test.use({ viewport: { width, height: 1100 } })
    test("restores a lost real response while disconnected without another PIN send", async ({ page }, info) => {
      const fixture = await backend.fixture(page, "EMAIL", true); await fixture.open()
      const panel = await approvePin(page), reviewId = await fixture.reviewId("verification_complete")
      await page.route(`**/verification-completion-reviews/${reviewId}/execute`, async route => {
        if (route.request().method() !== "POST") return route.continue()
        const response = await route.fetch(); expect(response.status()).toBe(200)
        await route.abort("failed")
      })
      await sendPin(page)
      await expect(panel.getByText(/send response was unavailable/)).toBeVisible()
      await expect(panel.getByRole("button", { name: "Check saved PIN outcome" })).toBeEnabled()
      await expect(panel.getByLabel("Re-enter reviewed PIN")).toHaveValue("")
      await capturePin(page, info, "lost-response")
      await fixture.disconnect(); await page.reload()
      await panel.getByRole("button", { name: "Open saved outcome" }).click()
      await expect(panel.getByText("Independently confirmed", { exact: true })).toBeVisible()
      await panel.getByRole("button", { name: "Refresh saved outcome" }).click()
      await expect(panel.getByText(/earlier evidence, not a fresh observation/)).toBeVisible()
      await capturePin(page, info, "disconnected-outcome")
      expect(fixture.completionWrites()).toHaveLength(1)
      await assertPinPrivacy(backend, fixture)
    })
    test("retains definitive rejection and sends a corrected PIN only after fresh approval", async ({ page }, info) => {
      const fixture = await backend.fixture(page, "ADDRESS", true); await fixture.open()
      const panel = await approvePin(page)
      backend.google.respond({ method: "POST", pathEndsWith: `${fixture.name}:complete` }, () => ({ status: 400, json: { error: { status: "INVALID_ARGUMENT", message: reviewedPin, details: [{ pin: reviewedPin }] } } }))
      await sendPin(page)
      await expect(panel.getByText("Google rejected the request", { exact: true })).toBeVisible()
      await capturePin(page, info, "rejected")
      await panel.getByRole("button", { name: "Refresh saved outcome" }).click()
      expect(fixture.completionWrites()).toHaveLength(1)
      await panel.getByRole("button", { name: "Check Google, then review a corrected PIN" }).click()
      await previewPin(page, "009999")
      await panel.getByRole("button", { name: "Approve PIN completion" }).click()
      backend.google.respond({ method: "POST", pathEndsWith: `${fixture.name}:complete` }, () => { fixture.setPhase("COMPLETED"); return { status: 200, json: { verification: fixture.verification() } } })
      await sendPin(page, "009999")
      await expect(panel.getByText("Independently confirmed", { exact: true })).toBeVisible()
      expect(fixture.completionWrites().map(call => call.body)).toEqual([{ pin: reviewedPin }, { pin: "009999" }])
      expect(await backend.admin`select id from gbp_management_mutation where organisation_id = ${fixture.owner.organisationId}`).toHaveLength(2)
      await capturePin(page, info, "corrected-outcome")
      await assertPinPrivacy(backend, fixture)
    })
    test("holds both workflows during slow PIN send and recovers after navigation", async ({ page }, info) => {
      const fixture = await backend.fixture(page, "PHONE_CALL", true); await fixture.open()
      const panel = await approvePin(page)
      let release: (() => void) | undefined
      const gate = new Promise<void>(resolve => { release = resolve })
      backend.google.respond({ method: "POST", pathEndsWith: `${fixture.name}:complete` }, async () => { fixture.setPhase("COMPLETED"); await gate; return { status: 200, json: { verification: fixture.verification() } } })
      try {
        await sendPin(page)
        await expect.poll(() => fixture.completionWrites().length).toBe(1)
        await expect(panel.getByText("Request action in progress. Wait for a response.")).toBeVisible()
        await expect(panel.getByText(/send response was unavailable/)).toHaveCount(0)
        await expect(page.locator('section[aria-labelledby="verification-start"]').getByRole("button", { name: "Check available methods" })).toBeDisabled()
        await capturePin(page, info, "slow-send")
        await page.goto(`${backend.server.baseUrl}/listings`)
      } finally { release?.() }
      await expect.poll(async () => {
        const [row] = await backend.admin`select execution_state, confirmation_state from gbp_management_mutation where organisation_id = ${fixture.owner.organisationId}`
        return row
      }).toMatchObject({ execution_state: "accepted", confirmation_state: "confirmed" })
      await fixture.open(); await panel.getByRole("button", { name: "Open saved outcome" }).click()
      await expect(panel.getByText("Independently confirmed", { exact: true })).toBeVisible()
      expect(fixture.completionWrites()).toHaveLength(1)
    })
    test("a second manager approves without restoring the PIN and revoked approver blocks execution", async ({ page }, info) => {
      const fixture = await backend.fixture(page, "SMS", true)
      await backend.admin`update organisation set require_two_person_approval = true where id = ${fixture.owner.organisationId}`
      const second = await seedMemberUser(backend.admin, { organisationId: fixture.owner.organisationId })
      await backend.admin`update member set role = 'admin', can_publish = true where user_id = ${second.userId}`
      await fixture.open(); const panel = await previewPin(page)
      await expect(panel.getByRole("button", { name: "Approve PIN completion" })).toBeDisabled()
      await page.context().clearCookies()
      await page.context().addCookies([{ name: "naba_session", value: second.cookie.slice("naba_session=".length), url: backend.server.baseUrl, httpOnly: true, sameSite: "Lax" }])
      await page.reload(); await panel.getByRole("button", { name: "Open saved review" }).click()
      await panel.getByRole("button", { name: "Approve PIN completion" }).click()
      await expect(panel.getByLabel("Re-enter reviewed PIN")).toHaveValue("")
      await capturePin(page, info, "second-manager-approved")
      await page.context().clearCookies()
      await page.context().addCookies([{ name: "naba_session", value: fixture.owner.cookie.slice("naba_session=".length), url: backend.server.baseUrl, httpOnly: true, sameSite: "Lax" }])
      await page.reload(); await panel.getByRole("button", { name: "Open saved review" }).click()
      await expect(panel.getByLabel("Re-enter reviewed PIN")).toHaveValue("")
      await backend.admin`update member set role = 'viewer', can_publish = false where user_id = ${second.userId}`
      await sendPin(page)
      await expect(panel.getByRole("button", { name: "Send approved PIN" })).toHaveCount(0)
      const [row] = await backend.admin`select requested_by, approved_by from gbp_change_set where id = ${await fixture.reviewId("verification_complete")}`
      expect(row).toMatchObject({ requested_by: fixture.owner.userId, approved_by: second.userId })
      expect(fixture.completionWrites()).toHaveLength(0)
      await capturePin(page, info, "revoked-approver")
    })
    for (const method of ["AUTO", "VETTED_PARTNER", "FUTURE_METHOD"] as const) {
      test(`pending ${method} uses Google handoff without PIN entry`, async ({ page }, info) => {
        const fixture = await backend.fixture(page, method, true); fixture.setPhase("PENDING"); await fixture.open()
        const panel = pinPanel(page)
        await expect(panel.getByText(/cannot accept a PIN here/)).toBeVisible()
        await expect(panel.getByLabel("PIN from Google")).toHaveCount(0)
        await expect(panel.getByRole("link", { name: "Continue verification in Google" })).toHaveAttribute("href", "https://business.google.com/")
        expect(fixture.completionWrites()).toHaveLength(0)
        await capturePin(page, info, `external-${method}`)
      })
    }
  })
}
