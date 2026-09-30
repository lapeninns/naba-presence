import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AdministrationProvider } from "@/components/locations/administration/context"
import { ReviewedStartVerification } from "@/components/locations/administration/verification-start"
import { ApiClientError } from "@/lib/api/client"
import { fetchGoogleVerificationOptions } from "@/lib/api/google-verification-options"
import { previewGoogleVerification, approveGoogleVerification, fetchGoogleVerificationReview } from "@/lib/api/google-verification-reviews"
import { executeGoogleVerification, fetchGoogleVerificationAttempt, refreshGoogleVerificationAttempt } from "@/lib/api/google-verification-attempt"
import { fetchGoogleVerificationWorkflows } from "@/lib/api/google-verification-workflows"
import type { VerificationOptionsResponse } from "@/lib/contracts/google-verification-options"
import type { VerificationReview } from "@/lib/contracts/google-verification-review"
import type { VerificationAttempt } from "@/lib/contracts/google-verification-attempt"
import { renderWithProviders } from "../helpers/render"

vi.mock("@/lib/api/google-verification-options")
vi.mock("@/lib/api/google-verification-reviews")
vi.mock("@/lib/api/google-verification-attempt")
vi.mock("@/lib/api/google-verification-workflows")
const id = "00000000-0000-4000-8000-000000000001", hash = "a".repeat(64)
const choice = { id: hash, kind: "email", method: "EMAIL", user: "owner", domain: "example.test", userNameEditable: true } as const
const options: VerificationOptionsResponse = { locationId: id, googleLocationName: "locations/camden", languageCode: "en-GB", customerLocationOnly: false, contextProvided: false, contextHash: hash, checkedAt: "2026-09-30T01:00:00Z", options: [choice] }
const review: VerificationReview = { choice, payload: { method: "EMAIL", languageCode: "en-GB", emailAddress: "owner@example.test" }, changeSet: { id, locationName: "Camden Hotel", payloadHash: hash, baselineHash: hash, payload: {}, baseline: {}, updateMask: [], requestedBy: id, approvedBy: null, requiresSecondApprover: false, canApprove: true, expiresAt: "2099-01-01T00:00:00Z" } }
const attempt: VerificationAttempt = { id, reviewId: id, payloadHash: hash, status: "ambiguous", executionState: "accepted", confirmationState: "unresolved", idempotent: false, verification: { name: "locations/camden/verifications/one", method: "EMAIL", providerState: "PENDING", phase: "pending", createTime: null }, merchant: { hasVoiceOfMerchant: false, hasBusinessAuthority: true, action: "verify", hasPendingVerification: true }, observedAt: "2026-09-30T01:00:00Z", error: "outcome_unresolved" }
beforeEach(() => {
  vi.mocked(fetchGoogleVerificationOptions).mockResolvedValue(options)
  vi.mocked(previewGoogleVerification).mockResolvedValue(review)
  vi.mocked(approveGoogleVerification).mockResolvedValue({ ...review, changeSet: { ...review.changeSet, approvedBy: id } })
  vi.mocked(executeGoogleVerification).mockResolvedValue(attempt)
  vi.mocked(fetchGoogleVerificationAttempt).mockResolvedValue(attempt)
  vi.mocked(refreshGoogleVerificationAttempt).mockResolvedValue({ ...attempt, error: "refresh_unavailable" })
  vi.mocked(fetchGoogleVerificationReview).mockResolvedValue(review)
  vi.mocked(fetchGoogleVerificationWorkflows).mockResolvedValue({ workflows: [], nextCursor: null })
})
afterEach(() => vi.resetAllMocks())
function render(blocked = false) { return renderWithProviders(<AdministrationProvider locationId={id} locationName="Camden Hotel" disabled={false} publishReason={blocked ? "Publishing paused" : null}><ReviewedStartVerification /></AdministrationProvider>) }
async function discover() { await userEvent.click(screen.getByRole("button", { name: "Check available methods" })); return screen.findByRole("radio", { name: /Email: owner/ }) }
async function preview() { await userEvent.click(await discover()); await userEvent.click(screen.getByRole("button", { name: "Review verification request" })); await screen.findByRole("button", { name: "Approve verification request" }) }
async function approve() { await preview(); await userEvent.click(screen.getByRole("button", { name: "Approve verification request" })); await screen.findByRole("button", { name: "Send approved verification request" }) }

describe("reviewed verification start", () => {
  it("discovers, reviews and approves the exact destination before a single send", async () => {
    render(); await approve()
    expect(previewGoogleVerification).toHaveBeenCalledWith(id, { optionId: hash, payload: review.payload })
    expect(executeGoogleVerification).not.toHaveBeenCalled()
    const send = screen.getByRole("button", { name: "Send approved verification request" })
    expect(screen.getByRole("region", { name: "Approved verification request actions" })).toContainElement(send)
    expect(send).toBeDisabled()
    await userEvent.click(screen.getByRole("checkbox", { name: "Send this exact approved verification request to Google." })); await userEvent.click(send)
    expect(await screen.findByText("Google accepted the request")).toBeInTheDocument()
    expect(screen.getByText("Confirmation unresolved")).toBeInTheDocument()
    expect(screen.queryByText("Verification completed")).not.toBeInTheDocument()
    expect(executeGoogleVerification).toHaveBeenCalledExactlyOnceWith(id, id, hash)
  })
  it("keeps same-method destinations distinct and edits only the chosen username", async () => {
    vi.mocked(fetchGoogleVerificationOptions).mockResolvedValue({ ...options, options: [choice, { ...choice, id: "b".repeat(64), user: "second" }] })
    render(); await discover()
    await userEvent.click(screen.getByRole("radio", { name: /Email: second/ }))
    const user = screen.getByLabelText("Email username"); await userEvent.clear(user); await userEvent.type(user, "operations")
    await userEvent.click(screen.getByRole("button", { name: "Review verification request" }))
    expect(previewGoogleVerification).toHaveBeenCalledWith(id, { optionId: "b".repeat(64), payload: { ...review.payload, emailAddress: "operations@example.test" } })
  })
  it("blocks preview behind the publish gate but permits safe discovery", async () => {
    render(true); await userEvent.click(await discover())
    expect(screen.getByRole("button", { name: "Review verification request" })).toBeDisabled()
    expect(previewGoogleVerification).not.toHaveBeenCalled()
  })
  it("requires a second manager and never sends while approval is absent", async () => {
    vi.mocked(previewGoogleVerification).mockResolvedValue({ ...review, changeSet: { ...review.changeSet, requiresSecondApprover: true, canApprove: false } })
    render(); await preview()
    expect(screen.getByRole("button", { name: "Approve verification request" })).toBeDisabled()
    expect(screen.getByText(/different authorised owner or admin/)).toBeInTheDocument()
    expect(executeGoogleVerification).not.toHaveBeenCalled()
  })
  it("holds a lost send response for read-only recovery without resubmission", async () => {
    vi.mocked(executeGoogleVerification).mockRejectedValue(new TypeError("lost response"))
    render(); await approve(); await userEvent.click(screen.getByRole("checkbox", { name: "Send this exact approved verification request to Google." }))
    await userEvent.click(screen.getByRole("button", { name: "Send approved verification request" }))
    expect(await screen.findByText(/response was unavailable/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Send approved verification request" })).toBeDisabled()
    await userEvent.click(screen.getByRole("button", { name: "Check saved request outcome" }))
    expect(await screen.findByText("Google accepted the request")).toBeInTheDocument()
    expect(fetchGoogleVerificationAttempt).toHaveBeenCalledExactlyOnceWith(id, id)
    expect(executeGoogleVerification).toHaveBeenCalledTimes(1)
  })
  it("lists a lost send as an unknown outcome and never says the request is approved", async () => {
    vi.mocked(executeGoogleVerification).mockRejectedValue(new TypeError("lost response"))
    vi.mocked(fetchGoogleVerificationWorkflows).mockResolvedValue({ workflows: [{ reviewId: id, createdAt: "2026-09-30T01:00:00Z", operation: "start_verification", method: "EMAIL", payloadHash: hash, requestedBy: id, approvedBy: id, requiresSecondApprover: false, expiresAt: "2099-01-01T00:00:00Z", canApprove: false, reviewReason: null, attempt: null }], nextCursor: null })
    render(); await approve(); await userEvent.click(screen.getByRole("checkbox", { name: "Send this exact approved verification request to Google." }))
    await userEvent.click(screen.getByRole("button", { name: "Send approved verification request" }))
    expect(await screen.findByText(/result of sending this approved request is unknown/)).toBeInTheDocument()
    expect(screen.queryByText("This request is approved.")).not.toBeInTheDocument()
    const saved = screen.getByRole("region", { name: "Saved verification requests" })
    expect(await within(saved).findByText("Email · Send outcome unknown")).toBeInTheDocument()
    expect(within(saved).queryByText(/Approved review/)).not.toBeInTheDocument()
  })
  it("keeps an active slow send distinct from an unavailable response", async () => {
    let finish: (value: VerificationAttempt) => void = () => { throw new Error("Send has not started") }
    vi.mocked(executeGoogleVerification).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    render(); await approve()
    await userEvent.click(screen.getByRole("checkbox", { name: "Send this exact approved verification request to Google." }))
    await userEvent.click(screen.getByRole("button", { name: "Send approved verification request" }))
    expect(screen.getByRole("button", { name: "Send approved verification request" })).toBeDisabled()
    expect(screen.queryByText(/response was unavailable/)).not.toBeInTheDocument()
    expect(screen.getByText("Request action in progress. Wait for a response.")).toBeInTheDocument()
    finish(attempt)
    expect(await screen.findByText("Google accepted the request")).toBeInTheDocument()
  })
  it("recovers a request rejected before its durable claim by rechecking the exact review", async () => {
    vi.mocked(executeGoogleVerification).mockRejectedValue(new ApiClientError(409, "publishing_paused", "paused"))
    vi.mocked(fetchGoogleVerificationAttempt).mockRejectedValue(new ApiClientError(404, "not_found", "missing"))
    render(); await approve(); await userEvent.click(screen.getByRole("checkbox", { name: "Send this exact approved verification request to Google." })); await userEvent.click(screen.getByRole("button", { name: "Send approved verification request" }))
    await screen.findByText(/response was unavailable/)
    await userEvent.click(screen.getByRole("button", { name: "Check saved request outcome" }))
    await waitFor(() => expect(fetchGoogleVerificationReview).toHaveBeenCalledWith(id, id))
    expect(await screen.findByRole("button", { name: "Approve verification request" })).toBeEnabled()
    expect(executeGoogleVerification).toHaveBeenCalledTimes(1)
  })
  it("retains prior observation when read-only refresh is unavailable", async () => {
    render(); await approve(); await userEvent.click(screen.getByRole("button", { name: "Check saved request outcome" }))
    await userEvent.click(await screen.findByRole("button", { name: "Refresh saved outcome" }))
    expect(await screen.findByText(/earlier evidence, not a fresh observation/)).toBeInTheDocument()
    expect(executeGoogleVerification).not.toHaveBeenCalled()
    expect(refreshGoogleVerificationAttempt).toHaveBeenCalledExactlyOnceWith(id, id)
  })
  it("blocks an expired approved review and permits returning to fresh methods", async () => {
    render(); await approve()
    await userEvent.click(screen.getByRole("checkbox", { name: "Send this exact approved verification request to Google." }))
    vi.mocked(fetchGoogleVerificationReview).mockRejectedValue(new ApiClientError(409, "approval_expired", "expired"))
    await userEvent.click(screen.getByRole("button", { name: "Refresh exact review" }))
    expect(await screen.findByText(/This approval has expired and the request can no longer be sent/)).toBeInTheDocument()
    // The recorded deadline is still in the future here; the server's expiry wins and no future time is shown.
    expect(screen.getByText("Approval has expired.")).toBeInTheDocument()
    expect(screen.queryByText(/Approval expires/)).not.toBeInTheDocument()
    expect(screen.queryByText("This request is approved.")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Send approved verification request" })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Back to methods" }))
    expect(screen.getByRole("button", { name: "Check available methods" })).toBeEnabled()
    expect(executeGoogleVerification).not.toHaveBeenCalled()
  })
  it("clears uncertainty only after authoritative no-attempt recovery and blocks the expired review", async () => {
    vi.mocked(executeGoogleVerification).mockRejectedValue(new TypeError("lost response"))
    vi.mocked(fetchGoogleVerificationAttempt).mockRejectedValue(new ApiClientError(404, "not_found", "missing"))
    vi.mocked(fetchGoogleVerificationReview).mockRejectedValue(new ApiClientError(409, "approval_expired", "expired"))
    render(); await approve()
    await userEvent.click(screen.getByRole("checkbox", { name: "Send this exact approved verification request to Google." }))
    await userEvent.click(screen.getByRole("button", { name: "Send approved verification request" }))
    await screen.findByText(/response was unavailable/)
    expect(screen.getByRole("button", { name: "Back to methods" })).toBeDisabled()
    await userEvent.click(screen.getByRole("button", { name: "Check saved request outcome" }))
    expect(await screen.findByText(/This approval has expired/)).toBeInTheDocument()
    expect(screen.queryByText("This request is approved.")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Send approved verification request" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Back to methods" })).toBeEnabled()
    expect(executeGoogleVerification).toHaveBeenCalledTimes(1)
  })
  it("labels an unapproved review's deadline as review expiry, not approval expiry", async () => {
    render(); await preview()
    expect(screen.getByText(`Review expires ${new Date(review.changeSet.expiresAt).toLocaleString("en-GB")}.`)).toBeInTheDocument()
    expect(screen.queryByText(/Approval expires/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Approve verification request" }))
    expect(await screen.findByText(`Approval expires ${new Date(review.changeSet.expiresAt).toLocaleString("en-GB")}.`)).toBeInTheDocument()
  })
  it("says an expired approval expired, with its past time, and never that it is approved", async () => {
    vi.mocked(approveGoogleVerification).mockResolvedValue({ ...review, changeSet: { ...review.changeSet, approvedBy: id, expiresAt: "2020-01-01T00:00:00Z" } })
    render(); await preview()
    await userEvent.click(screen.getByRole("button", { name: "Approve verification request" }))
    expect(await screen.findByText(`Approval expired at ${new Date("2020-01-01T00:00:00Z").toLocaleString("en-GB")}.`)).toBeInTheDocument()
    expect(screen.getByText(/This approval has expired/)).toBeInTheDocument()
    expect(screen.queryByText("This request is approved.")).not.toBeInTheDocument()
    expect(screen.queryByText(/Approval expires/)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Send approved verification request" })).not.toBeInTheDocument()
  })
  it("humanises an unknown method offered by Google without a send action", async () => {
    vi.mocked(fetchGoogleVerificationOptions).mockResolvedValue({ ...options, options: [{ id: "c".repeat(64), kind: "external", method: "FUTURE_METHOD", reason: "unknown_method" }] })
    render(); await userEvent.click(screen.getByRole("button", { name: "Check available methods" }))
    const option = await screen.findByRole("radio", { name: /Another Google method:/ })
    expect(screen.getByText("Google method code: FUTURE_METHOD")).toBeInTheDocument()
    expect(screen.queryByText("FUTURE METHOD")).not.toBeInTheDocument()
    await userEvent.click(option)
    expect(screen.queryByRole("button", { name: "Review verification request" })).not.toBeInTheDocument()
  })
  it("requires rediscovery after the message language changes", async () => {
    render(); await userEvent.click(await discover())
    const language = screen.getByLabelText("Verification language"); await userEvent.clear(language); await userEvent.type(language, "cy")
    expect(screen.queryByRole("radio")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Review verification request" })).not.toBeInTheDocument()
    expect(previewGoogleVerification).not.toHaveBeenCalled()
  })
  it("restores a saved team review after reload without creating another preview", async () => {
    const first = render(); await preview(); first.unmount()
    vi.mocked(fetchGoogleVerificationWorkflows).mockResolvedValue({ workflows: [{ reviewId: id, createdAt: options.checkedAt, operation: "start_verification", method: "EMAIL", payloadHash: hash, requestedBy: id, approvedBy: null, requiresSecondApprover: false, expiresAt: review.changeSet.expiresAt, canApprove: true, reviewReason: null, attempt: null }], nextCursor: null })
    render(); await userEvent.click(await screen.findByRole("button", { name: "Open saved review" }))
    expect(await screen.findByRole("button", { name: "Approve verification request" })).toBeEnabled()
    expect(fetchGoogleVerificationReview).toHaveBeenCalledExactlyOnceWith(id, id)
    expect(previewGoogleVerification).toHaveBeenCalledTimes(1)
    expect(executeGoogleVerification).not.toHaveBeenCalled()
  })
  it("opens a saved attempt directly even when its review is expired", async () => {
    vi.mocked(fetchGoogleVerificationWorkflows).mockResolvedValue({ workflows: [{ reviewId: id, createdAt: options.checkedAt, operation: "start_verification", method: "EMAIL", payloadHash: hash, requestedBy: id, approvedBy: id, requiresSecondApprover: false, expiresAt: "2020-01-01T00:00:00Z", canApprove: false, reviewReason: "expired", attempt: { id, status: "ambiguous", executionState: "accepted", confirmationState: "unresolved", observedAt: attempt.observedAt } }], nextCursor: null })
    render(true); await userEvent.click(await screen.findByRole("button", { name: "Open saved outcome" }))
    expect(await screen.findByText("Confirmation unresolved")).toBeInTheDocument()
    expect(fetchGoogleVerificationReview).not.toHaveBeenCalled()
    expect(fetchGoogleVerificationAttempt).toHaveBeenCalledExactlyOnceWith(id, id)
    expect(screen.getByRole("button", { name: "Refresh saved outcome" })).toBeEnabled()
    expect(executeGoogleVerification).not.toHaveBeenCalled()
  })
})
