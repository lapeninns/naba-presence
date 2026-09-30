import { expect, test, type Page } from "@playwright/test"
import { startVerificationBackend, type StartMethod } from "./helpers/verification-backend"
import { captureVerificationStart } from "./helpers/verification-capture"
import { seedMemberUser } from "../integration/helpers/tenant"

let backend: Awaited<ReturnType<typeof startVerificationBackend>>
test.beforeAll(async () => { backend = await startVerificationBackend() })
test.afterAll(async () => { await backend.stop() })
test.beforeEach(async ({ context }) => {
  await context.route("**/*", (route) => new URL(route.request().url()).origin === backend.server.baseUrl ? route.continue() : route.abort("blockedbyclient"))
})

async function selectMethod(page: Page, method: StartMethod) {
  const panel = page.locator('section[aria-labelledby="verification-start"]')
  await expect(panel.getByRole("button", { name: "Check available methods" })).toBeEnabled()
  if (method === "ADDRESS") {
    await panel.getByRole("checkbox", { name: "Provide a private service-business address" }).check()
    await panel.getByLabel("Street address").fill("10 Fixture Service Road")
    await panel.getByLabel("Town or city", { exact: true }).fill("London")
    await panel.getByLabel("Postcode", { exact: true }).fill("SW1A 1AA")
  }
  await panel.getByRole("button", { name: "Check available methods" }).click()
  await panel.getByRole("radio").check()
  if (method === "EMAIL") await panel.getByLabel("Email username").fill("operations")
  if (method === "PHONE_CALL" || method === "SMS") {
    await expect(panel.getByLabel("Eligible phone destination")).toHaveValue("+44 20 0000 0001")
    await expect(panel.getByLabel("Eligible phone destination")).toHaveAttribute("readonly", "")
  }
  if (method === "ADDRESS") await panel.getByLabel("Postcard contact name").fill("Fixture Manager")
  return panel
}

for (const width of [375, 768, 1280]) {
  for (const method of ["EMAIL", "PHONE_CALL", "SMS", "ADDRESS", "AUTO"] as const) {
    test(`real backend reviewed ${method} start at ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 1100 })
      const fixture = await backend.fixture(page, method); await fixture.open()
      const panel = await selectMethod(page, method)
      await captureVerificationStart(page, info, `${method}-${width}-destination`)
      await panel.getByRole("button", { name: "Review verification request" }).click()
      await expect(panel.getByRole("button", { name: "Approve verification request" })).toBeEnabled()
      expect(fixture.writes()).toHaveLength(0)
      await captureVerificationStart(page, info, `${method}-${width}-review`)
      await panel.getByRole("button", { name: "Approve verification request" }).click()
      const send = panel.getByRole("button", { name: "Send approved verification request" })
      await expect(send).toBeDisabled()
      await expect(panel.getByRole("region", { name: "Approved verification request actions" })).toContainText("Confirm the exact approved request before sending.")
      await captureVerificationStart(page, info, `${method}-${width}-approved`)
      await panel.getByRole("checkbox", { name: "Send this exact approved verification request to Google." }).focus()
      await page.keyboard.press("Space")
      await expect(panel.getByRole("region", { name: "Approved verification request actions" })).toContainText("Send only this exact approved request to Google.")
      await send.focus()
      await captureVerificationStart(page, info, `${method}-${width}-keyboard-ready`)
      await page.keyboard.press("Enter")
      await expect(panel.getByText("Google accepted the request", { exact: true })).toBeVisible()
      await expect(panel.getByText("Independently confirmed", { exact: true })).toBeVisible()
      await expect(panel.getByText("Google does not report voice of merchant", { exact: true })).toBeVisible()
      expect(fixture.writes()).toHaveLength(1)
      expect(fixture.writes()[0].body).toEqual({ method, languageCode: "en-GB", ...(method === "EMAIL" ? { emailAddress: "operations@example.test" } : method === "PHONE_CALL" || method === "SMS" ? { phoneNumber: "+44 20 0000 0001" } : method === "ADDRESS" ? { mailerContact: "Fixture Manager", context: { address: fixture.address } } : {}) })
      const writeIndex = backend.google.calls.findIndex((call) => call.path.endsWith(":verify"))
      expect(backend.google.calls.slice(writeIndex + 1).some((call) => call.method === "GET" && call.path.includes(`${fixture.linked.googleLocationName}/verifications`))).toBe(true)
      await captureVerificationStart(page, info, `${method}-${width}-outcome`)
      await page.reload()
      await panel.getByRole("button", { name: "Open saved outcome" }).click()
      await expect(panel.getByText("Independently confirmed", { exact: true })).toBeVisible()
      expect(fixture.writes()).toHaveLength(1)
      expect(backend.google.calls.some((call) => call.path.includes("/admins"))).toBe(false)
      const ordinary = await backend.admin`select requested_payload, google_response, confirmation_response from gbp_management_mutation where organisation_id = ${fixture.owner.organisationId}`
      expect(ordinary).toHaveLength(1)
      expect(JSON.stringify(ordinary)).not.toContain(fixture.address.addressLines[0])
      expect(await page.evaluate(() => `${location.href} ${JSON.stringify(localStorage)} ${JSON.stringify(sessionStorage)}`)).not.toContain(fixture.address.addressLines[0])
    })
  }
}

for (const width of [375, 768, 1280]) {
test.describe(`recovery at ${width}px`, () => {
test.use({ viewport: { width, height: 1100 } })

test("real backend lost response recovers after navigation and disconnection without another send", async ({ page }, info) => {
  const fixture = await backend.fixture(page); await fixture.open()
  const panel = await selectMethod(page, "EMAIL")
  await panel.getByRole("button", { name: "Review verification request" }).click()
  await panel.getByRole("button", { name: "Approve verification request" }).click()
  await expect(panel.getByRole("button", { name: "Send approved verification request" })).toBeDisabled()
  await page.route("**/verification-reviews/*/execute", async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    expect(response.status(), body.error ?? "Reviewed execution response").toBe(200)
    await route.abort("failed")
  })
  await panel.getByRole("checkbox", { name: "Send this exact approved verification request to Google." }).check()
  await panel.getByRole("button", { name: "Send approved verification request" }).click()
  await expect(panel.getByText(/The response was unavailable/)).toBeVisible()
  await expect(panel.getByRole("button", { name: "Check saved request outcome" })).toBeEnabled()
  await expect(panel.getByRole("button", { name: "Send approved verification request" })).toBeDisabled()
  await captureVerificationStart(page, info, "lost-response")
  await page.unroute("**/verification-reviews/*/execute")
  await fixture.disconnect(); await page.reload()
  await expect(page.getByText("Current Google state could not be read", { exact: true })).toBeVisible()
  await panel.getByRole("button", { name: "Open saved outcome" }).click()
  await expect(panel.getByText("Independently confirmed", { exact: true })).toBeVisible()
  await panel.getByRole("button", { name: "Refresh saved outcome" }).click()
  await expect(panel.getByText(/earlier evidence, not a fresh observation/)).toBeVisible()
  await captureVerificationStart(page, info, "disconnected-recovery")
  expect(fixture.writes()).toHaveLength(1)
})

test("real backend expired approval cannot send", async ({ page }, info) => {
  const fixture = await backend.fixture(page); await fixture.open()
  const panel = await selectMethod(page, "EMAIL")
  await panel.getByRole("button", { name: "Review verification request" }).click()
  await panel.getByRole("button", { name: "Approve verification request" }).click()
  await expect(panel.getByRole("button", { name: "Send approved verification request" })).toBeDisabled()
  const id = await fixture.reviewId()
  await backend.admin`update gbp_change_set set approval_expires_at = now() - interval '1 minute' where id = ${id}`
  await panel.getByRole("button", { name: "Refresh exact review" }).click()
  await expect(panel.getByRole("alert")).toContainText("This review has expired")
  // An expired approval offers no send at all, and says the approval expired.
  await expect(panel.getByRole("button", { name: "Send approved verification request" })).toHaveCount(0)
  await expect(panel.getByRole("status").filter({ hasText: "This approval has expired" })).toBeVisible()
  expect(fixture.writes()).toHaveLength(0)
  await captureVerificationStart(page, info, "expired-review")
})

test("real backend policy change rejects approval before any provider write", async ({ page }, info) => {
  const fixture = await backend.fixture(page); await fixture.open()
  const panel = await selectMethod(page, "EMAIL")
  await panel.getByRole("button", { name: "Review verification request" }).click()
  await expect(panel.getByRole("button", { name: "Approve verification request" })).toBeEnabled()
  await backend.admin`update organisation set require_two_person_approval = true where id = ${fixture.owner.organisationId}`
  await panel.getByRole("button", { name: "Approve verification request" }).click()
  await expect(panel.getByRole("alert")).toBeVisible()
  await expect(panel.getByRole("button", { name: "Send approved verification request" })).toHaveCount(0)
  expect(fixture.writes()).toHaveLength(0)
  expect(await backend.admin`select id from gbp_management_mutation where organisation_id = ${fixture.owner.organisationId}`).toHaveLength(0)
  await captureVerificationStart(page, info, "approval-policy-changed")
})

test("real backend provider rejection is retained without replay", async ({ page }, info) => {
  const fixture = await backend.fixture(page); await fixture.open()
  const panel = await selectMethod(page, "EMAIL")
  await panel.getByRole("button", { name: "Review verification request" }).click()
  await panel.getByRole("button", { name: "Approve verification request" }).click()
  backend.google.respond({ method: "POST", pathEndsWith: `${fixture.linked.googleLocationName}:verify` }, () => ({ status: 400, json: { error: { status: "INVALID_ARGUMENT", message: "fixture-private-rejection-echo" } } }))
  await panel.getByRole("checkbox", { name: "Send this exact approved verification request to Google." }).check()
  await panel.getByRole("button", { name: "Send approved verification request" }).click()
  await expect(panel.getByText("Google rejected the request", { exact: true })).toBeVisible()
  await expect(panel.getByRole("button", { name: "Send approved verification request" })).toHaveCount(0)
  await expect(panel).not.toContainText("fixture-private-rejection-echo")
  await panel.getByRole("button", { name: "Refresh saved outcome" }).click()
  await expect(panel.getByText("Google rejected the request", { exact: true })).toBeVisible()
  expect(fixture.writes()).toHaveLength(1)
  await captureVerificationStart(page, info, "provider-rejected")
})

test("real backend slow send survives navigation without replay", async ({ page }, info) => {
  const fixture = await backend.fixture(page); await fixture.open()
  const panel = await selectMethod(page, "EMAIL")
  await panel.getByRole("button", { name: "Review verification request" }).click()
  await panel.getByRole("button", { name: "Approve verification request" }).click()
  let applied = false
  let releaseProvider: () => void = () => { throw new Error("Provider gate not initialised") }
  const providerGate = new Promise<void>((resolve) => { releaseProvider = resolve })
  backend.google.respond({ method: "GET", pathIncludes: `${fixture.linked.googleLocationName}/verifications` }, () => ({ status: 200, json: { verifications: applied ? [{ name: fixture.name, method: "EMAIL", state: "PENDING" }] : [] } }))
  backend.google.respond({ method: "POST", pathEndsWith: `${fixture.linked.googleLocationName}:verify` }, async () => { applied = true; await providerGate; return { status: 200, json: { verification: { name: fixture.name, method: "EMAIL", state: "PENDING" } } } })
  await panel.getByRole("checkbox", { name: "Send this exact approved verification request to Google." }).check()
  try {
    await panel.getByRole("button", { name: "Send approved verification request" }).click()
    await expect.poll(() => fixture.writes().length).toBe(1)
    await expect(panel.getByRole("button", { name: "Send approved verification request" })).toBeDisabled()
    await expect(panel.getByText(/The response was unavailable/)).toHaveCount(0)
    await expect(panel.getByText("Request action in progress. Wait for a response.")).toBeVisible()
    await captureVerificationStart(page, info, "slow-send")
    await page.goto(`${backend.server.baseUrl}/listings`)
  } finally { releaseProvider() }
  await expect.poll(async () => (await backend.admin`select execution_state from gbp_management_mutation where organisation_id = ${fixture.owner.organisationId}`)[0]?.execution_state).toBe("accepted")
  await fixture.open()
  await panel.getByRole("button", { name: "Open saved outcome" }).click()
  await expect(panel.getByText("Google accepted the request", { exact: true })).toBeVisible()
  await captureVerificationStart(page, info, "navigation-recovered")
  expect(fixture.writes()).toHaveLength(1)
})

test("real backend second manager restores and approves the exact saved review", async ({ page }, info) => {
  const fixture = await backend.fixture(page)
  await backend.admin`update organisation set require_two_person_approval = true where id = ${fixture.owner.organisationId}`
  await fixture.open(); const panel = await selectMethod(page, "EMAIL")
  await panel.getByRole("button", { name: "Review verification request" }).click()
  await expect(panel.getByRole("button", { name: "Approve verification request" })).toBeDisabled()
  await expect(panel.getByText(/different authorised owner or admin/)).toBeVisible()
  await captureVerificationStart(page, info, "second-manager-required")
  const second = await seedMemberUser(backend.admin, { organisationId: fixture.owner.organisationId })
  await backend.admin`update member set role = 'admin', can_publish = true where user_id = ${second.userId}`
  await page.context().clearCookies()
  await page.context().addCookies([{ name: "naba_session", value: second.cookie.slice("naba_session=".length), url: backend.server.baseUrl, httpOnly: true, sameSite: "Lax" }])
  await page.reload(); await panel.getByRole("button", { name: "Open saved review" }).click()
  await expect(panel.getByRole("button", { name: "Approve verification request" })).toBeEnabled()
  await panel.getByRole("button", { name: "Approve verification request" }).click()
  await expect(panel.getByRole("button", { name: "Send approved verification request" })).toBeDisabled()
  const id = await fixture.reviewId()
  const [review] = await backend.admin`select requested_by, approved_by from gbp_change_set where id = ${id}`
  expect(review).toEqual({ requested_by: fixture.owner.userId, approved_by: second.userId })
  expect(fixture.writes()).toHaveLength(0)
  await captureVerificationStart(page, info, "second-manager-approved")
})

for (const method of ["VETTED_PARTNER", "FUTURE_METHOD"] as const) {
  test(`real backend ${method} provides Google handoff without active send`, async ({ page }, info) => {
    const fixture = await backend.fixture(page, method); await fixture.open()
    const panel = page.locator('section[aria-labelledby="verification-start"]')
    await panel.getByRole("button", { name: "Check available methods" }).click()
    await panel.getByRole("radio").check()
    await expect(panel.getByText(/This method must be completed through Google/)).toBeVisible()
    await expect(panel.getByRole("button", { name: "Review verification request" })).toHaveCount(0)
    await expect(panel.getByRole("link", { name: "Open Google Business Profile" })).toHaveAttribute("href", "https://business.google.com/")
    expect(fixture.writes()).toHaveLength(0)
    await captureVerificationStart(page, info, method)
  })
}
})
}
