import {
  expect,
  test,
  type Page,
  type Response,
  type TestInfo,
} from "@playwright/test"
import { startVerificationBackend } from "./helpers/verification-backend"
import {
  approvePin,
  assertPinPrivacy,
  capturePin,
  sendPin,
  type VerificationBackend,
} from "./helpers/verification-pin-backend"
import { JOURNEY_WIDTH, LAYOUT_WIDTHS, viewportAt } from "./helpers/widths"

let backend: VerificationBackend
// Approval refetches current Google state, and the page rightly withholds a send
// while that read fails. Drift lands after this last good read, so the send
// reaches the server, whose own drift check is what these tests cover.
async function stateReadAfterApproval(page: Page) {
  let approved = false
  const onResponse = (response: Response) => {
    if (
      response.request().method() === "POST" &&
      /\/verification-completion-reviews\/[^/]+$/.test(
        new URL(response.url()).pathname
      )
    )
      approved = true
  }
  page.on("response", onResponse)
  try {
    const read = await page.waitForResponse(
      (response) =>
        approved &&
        response.request().method() === "GET" &&
        new URL(response.url()).pathname.endsWith("/verification-state")
    )
    expect(read.ok()).toBe(true)
  } finally {
    page.off("response", onResponse)
  }
}
test.beforeAll(async () => {
  backend = await startVerificationBackend()
})
test.afterAll(async () => {
  await backend.stop()
})
test.beforeEach(async ({ context }) => {
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === backend.server.baseUrl
      ? route.continue()
      : route.abort("blockedbyclient")
  )
})
type DriftKind = "expiry" | "policy" | "generation" | "target" | "phase" | "pin"
/** Drift after approval: the send is refused with no provider write and a fresh review is the only way on. */
async function blockedAfterDrift(page: Page, info: TestInfo, kind: DriftKind) {
  const fixture = await backend.fixture(page, "SMS", true)
  await fixture.open()
  const settled = stateReadAfterApproval(page)
  const panel = await approvePin(page),
    reviewId = await fixture.reviewId("verification_complete")
  await settled
  switch (kind) {
    case "expiry":
      await backend.admin`update gbp_change_set set approval_expires_at = now() - interval '1 minute' where id = ${reviewId}`
      break
    case "policy":
      await backend.admin`update organisation set require_two_person_approval = true where id = ${fixture.owner.organisationId}`
      break
    case "generation":
      await backend.admin`update google_connection set credential_generation = credential_generation + 1 where id = ${fixture.connection.connectionId}`
      break
    case "target":
      await backend.admin`update external_location set google_location_name = 'locations/relinked-fixture' where id = ${fixture.linked.externalLocationId}`
      break
    case "phase":
      fixture.setPhase("COMPLETED")
      break
    case "pin":
      break
  }
  await sendPin(page, kind === "pin" ? "009999" : "001234")
  await expect(
    panel.getByRole("button", { name: "Send approved PIN" })
  ).toHaveCount(0)
  await expect(panel.getByRole("alert").first()).toBeVisible()
  expect(fixture.completionWrites()).toHaveLength(0)
  expect(
    await backend.admin`select id from gbp_management_mutation where change_set_id = ${reviewId}`
  ).toHaveLength(0)
  await capturePin(page, info, `blocked-${kind}`)
  await panel.getByRole("button", { name: "Create a fresh PIN review" }).click()
  await expect(
    panel.getByRole("heading", { name: "Review PIN completion" })
  ).toHaveCount(0)
  await assertPinPrivacy(backend, fixture)
}
/** An uncertain send over an expired approval is discarded only after the authoritative check, with no durable attempt. */
async function expiredUncertainSend(page: Page, info: TestInfo) {
  const fixture = await backend.fixture(page, "EMAIL", true)
  await fixture.open()
  const panel = await approvePin(page),
    reviewId = await fixture.reviewId("verification_complete")
  await backend.admin`update gbp_change_set set approval_expires_at = now() - interval '1 minute' where id = ${reviewId}`
  const execute = `**/verification-completion-reviews/${reviewId}/execute`
  await page.route(execute, (route) =>
    route.request().method() === "POST"
      ? route.abort("failed")
      : route.continue()
  )
  await sendPin(page)
  await expect(panel.getByText(/send response was unavailable/)).toBeVisible()
  await page.unroute(execute)
  await panel.getByRole("button", { name: "Check saved PIN outcome" }).click()
  await expect(
    panel.getByRole("button", { name: "Send approved PIN" })
  ).toHaveCount(0)
  await expect(
    panel.getByRole("button", { name: "Create a fresh PIN review" })
  ).toBeEnabled()
  await capturePin(page, info, "absent-expired-recovery")
  await panel.getByRole("button", { name: "Create a fresh PIN review" }).click()
  await expect(panel.getByLabel("PIN from Google")).toHaveValue("")
  expect(fixture.completionWrites()).toHaveLength(0)
}
test.describe(`PIN drift journeys at ${JOURNEY_WIDTH}px`, () => {
  test.use({ viewport: viewportAt(JOURNEY_WIDTH) })
  for (const kind of [
    "expiry",
    "policy",
    "generation",
    "target",
    "phase",
    "pin",
  ] as const)
    test(`requires a fresh review after ${kind} changes without a provider send`, async ({
      page,
    }, info) => {
      await blockedAfterDrift(page, info, kind)
    })
  test("checks authoritative expiry before discarding an uncertain request with no durable attempt", async ({
    page,
  }, info) => {
    await expiredUncertainSend(page, info)
  })
})
// Every kind lands on the same blocked panel; one of them is enough to check it fits.
for (const width of LAYOUT_WIDTHS)
  test.describe(`PIN drift layout at ${width}px`, () => {
    test.use({ viewport: viewportAt(width) })
    test("fits the blocked review and its fresh-review action", async ({
      page,
    }, info) => {
      await blockedAfterDrift(page, info, "expiry")
    })
  })
