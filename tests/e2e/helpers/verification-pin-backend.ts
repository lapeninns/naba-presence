import { expect, type Page, type TestInfo } from "@playwright/test"
import type { startVerificationBackend } from "./verification-backend"
import { captureVerificationSection } from "./verification-capture"

export type VerificationBackend = Awaited<ReturnType<typeof startVerificationBackend>>
export type VerificationFixture = Awaited<ReturnType<VerificationBackend["fixture"]>>
export const reviewedPin = "001234"
export const pinPanel = (page: Page) => page.locator('section[aria-labelledby="verification-pin"]')
export const capturePin = (page: Page, info: TestInfo, name: string) => captureVerificationSection(page, info, { name, section: "verification-pin" })

export async function previewPin(page: Page, pin = reviewedPin) {
  const panel = pinPanel(page)
  await expect(panel.getByLabel("PIN from Google")).toBeEnabled()
  await panel.getByLabel("PIN from Google").fill(pin)
  await panel.getByRole("button", { name: "Review PIN completion" }).click()
  await expect(panel.getByRole("button", { name: "Approve PIN completion" })).toBeVisible()
  await expect(panel.getByLabel("PIN from Google")).toHaveCount(0)
  return panel
}

export async function approvePin(page: Page) {
  const panel = await previewPin(page)
  await panel.getByRole("button", { name: "Approve PIN completion" }).click()
  await expect(panel.getByLabel("Re-enter reviewed PIN")).toHaveValue("")
  return panel
}

export async function sendPin(page: Page, pin = reviewedPin) {
  const panel = pinPanel(page)
  await panel.getByLabel("Re-enter reviewed PIN").fill(pin)
  await panel.getByRole("checkbox", { name: "Submit the reviewed PIN to this exact Google verification request." }).check()
  await panel.getByRole("button", { name: "Send approved PIN" }).click()
}

export async function assertPinPrivacy(backend: VerificationBackend, fixture: VerificationFixture) {
  const reviews = await backend.admin`select payload, baseline from gbp_change_set where organisation_id = ${fixture.owner.organisationId}`
  const attempts = await backend.admin`select requested_payload, google_response, confirmation_response, last_error_code from gbp_management_mutation where organisation_id = ${fixture.owner.organisationId}`
  const audit = await backend.admin`select metadata from audit_log where organisation_id = ${fixture.owner.organisationId}`
  const snapshots = await backend.admin`select payload from gbp_resource_snapshot where organisation_id = ${fixture.owner.organisationId}`
  expect(JSON.stringify({ reviews, attempts, audit, snapshots })).not.toContain(reviewedPin)
}
