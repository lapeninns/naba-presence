import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AdministrationProvider } from "@/components/locations/administration/context"
import { ReviewedCompletionVerification } from "@/components/locations/administration/verification-completion"
import { ApiClientError } from "@/lib/api/client"
import { previewGoogleVerificationCompletion, approveGoogleVerificationCompletion, fetchGoogleVerificationCompletionReview } from "@/lib/api/google-verification-completion-reviews"
import { executeGoogleVerificationCompletion, fetchGoogleVerificationCompletionAttempt, refreshGoogleVerificationCompletionAttempt } from "@/lib/api/google-verification-completion-attempt"
import { fetchGoogleVerificationWorkflows } from "@/lib/api/google-verification-workflows"
import { fetchGoogleVerificationState } from "@/lib/api/google-verification-state"
import type { ObservedVerification } from "@/lib/contracts/google-verification-state"
import { completionLocationId as locationId, completionReviewId as reviewId, completionHash as hash, completionRequest as request, completionReview as review, completionAttempt as attempt, completionWorkflow as workflow } from "../helpers/verification-completion"

vi.mock("@/lib/api/google-verification-completion-reviews")
vi.mock("@/lib/api/google-verification-completion-attempt")
vi.mock("@/lib/api/google-verification-workflows")
vi.mock("@/lib/api/google-verification-state")
beforeEach(() => {
  vi.mocked(previewGoogleVerificationCompletion).mockResolvedValue(review)
  vi.mocked(approveGoogleVerificationCompletion).mockResolvedValue({ ...review, changeSet: { ...review.changeSet, approvedBy: locationId } })
  vi.mocked(fetchGoogleVerificationCompletionReview).mockResolvedValue({ ...review, changeSet: { ...review.changeSet, approvedBy: locationId } })
  vi.mocked(executeGoogleVerificationCompletion).mockResolvedValue(attempt)
  vi.mocked(fetchGoogleVerificationCompletionAttempt).mockResolvedValue(attempt)
  vi.mocked(refreshGoogleVerificationCompletionAttempt).mockResolvedValue({ ...attempt, error: "refresh_unavailable" })
  vi.mocked(fetchGoogleVerificationWorkflows).mockResolvedValue({ workflows: [], nextCursor: null })
  vi.mocked(fetchGoogleVerificationState).mockResolvedValue({ locationId, googleLocationName: "locations/camden", checkedAt: "2026-09-30T02:00:00Z", verifications: [{ ...request, phase: "completed", providerState: "COMPLETED" }], merchant: null, merchantError: "verification_merchant_state_unavailable" })
})
afterEach(() => vi.resetAllMocks())
function fixture(verifications: readonly ObservedVerification[] = [request], blocked = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(<QueryClientProvider client={client}><AdministrationProvider locationId={locationId} locationName="Camden Hotel" disabled={false} publishReason={blocked ? "Publishing paused" : null}><ReviewedCompletionVerification verifications={verifications} /></AdministrationProvider></QueryClientProvider>)
  return { client, view }
}
async function preview(pin = "001234") { await userEvent.type(screen.getByLabelText("PIN from Google"), pin); await userEvent.click(screen.getByRole("button", { name: "Review PIN completion" })); await screen.findByRole("button", { name: "Approve PIN completion" }) }
async function approve() { await preview(); await userEvent.click(screen.getByRole("button", { name: "Approve PIN completion" })); await screen.findByLabelText("Re-enter reviewed PIN") }
async function send(pin = "001234") { await userEvent.type(screen.getByLabelText("Re-enter reviewed PIN"), pin); await userEvent.click(screen.getByRole("checkbox", { name: "Submit the reviewed PIN to this exact Google verification request." })); await userEvent.click(screen.getByRole("button", { name: "Send approved PIN" })) }

const requested = new Date(request.createTime ?? "").toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
const described = `Text message verification, requested ${requested}`

describe("PIN completion presentation", () => {
  it("describes pending and reviewed requests in words, keeping Google's resource name as a secondary reference", async () => {
    fixture()
    const pendingList = screen.getByRole("list", { name: "Pending verification requests" })
    expect(within(pendingList).getByText(described)).toBeInTheDocument()
    expect(within(pendingList).getByText(`Google reference: ${request.name}`)).toHaveClass("break-all", "text-ink-muted")
    expect(within(pendingList).queryByText(request.name)).not.toBeInTheDocument()
    await approve()
    const row = screen.getByText("Verification request", { selector: "dt" }).parentElement
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText(described)).toBeInTheDocument()
    expect(within(row as HTMLElement).getByText(`Google reference: ${request.name}`)).toHaveClass("break-all")
  })
  it("reports merchant standing in plain language", async () => {
    fixture(); await approve(); await send()
    expect(await screen.findByText("Google hasn't yet confirmed you can manage this listing")).toBeInTheDocument()
    expect(screen.queryByText(/voice of merchant/i)).not.toBeInTheDocument()
  })
  it("never lists or presents a lost send as an approved review", async () => {
    vi.mocked(executeGoogleVerificationCompletion).mockRejectedValue(new TypeError("lost send"))
    vi.mocked(fetchGoogleVerificationWorkflows).mockResolvedValue({ workflows: [{ ...workflow, approvedBy: locationId }], nextCursor: null })
    fixture(); await approve(); await send()
    expect(await screen.findByText(/result of sending this approved PIN is unknown/)).toBeInTheDocument()
    expect(screen.queryByText("This PIN completion is approved.")).not.toBeInTheDocument()
    const saved = screen.getByRole("region", { name: "Saved PIN completions" })
    expect(await within(saved).findByText("Text message · Send outcome unknown")).toBeInTheDocument()
    expect(within(saved).queryByText(/Approved review/)).not.toBeInTheDocument()
  })
  it("lists an approval the server refused as no longer valid", async () => {
    vi.mocked(fetchGoogleVerificationWorkflows).mockResolvedValue({ workflows: [{ ...workflow, approvedBy: locationId }], nextCursor: null })
    vi.mocked(executeGoogleVerificationCompletion).mockRejectedValue(new ApiClientError(409, "approval_actor_access_changed", "private echo"))
    fixture(); await approve(); await send()
    const saved = screen.getByRole("region", { name: "Saved PIN completions" })
    expect(await within(saved).findByText("Text message · Approval no longer valid")).toBeInTheDocument()
    expect(within(saved).queryByText(/Approved review/)).not.toBeInTheDocument()
  })
  it.each(["policy_changed", "actor_access_changed", "credential_changed", "review_unreadable"] as const)("lists a saved approval invalidated by %s as no longer valid", async (reviewReason) => {
    vi.mocked(fetchGoogleVerificationWorkflows).mockResolvedValue({ workflows: [{ ...workflow, approvedBy: locationId, reviewReason }], nextCursor: null })
    fixture([])
    expect(await screen.findByText("Text message · Approval no longer valid")).toBeInTheDocument()
    expect(screen.queryByText(/Approved review/)).not.toBeInTheDocument()
  })
  it("lists a recorded attempt with an unknown execution as an unknown send outcome", async () => {
    vi.mocked(fetchGoogleVerificationWorkflows).mockResolvedValue({ workflows: [{ ...workflow, approvedBy: locationId, attempt: { id: reviewId, status: "ambiguous", executionState: "unknown", confirmationState: "unresolved", observedAt: null } }], nextCursor: null })
    fixture([])
    expect(await screen.findByText("Text message · Send outcome unknown")).toBeInTheDocument()
  })
  it("lets the rejected-PIN recovery label wrap on narrow screens", async () => {
    vi.mocked(executeGoogleVerificationCompletion).mockResolvedValue({ ...attempt, status: "failed", executionState: "rejected", confirmationState: "unrecorded", error: "completion_rejected" })
    fixture(); await approve(); await send()
    expect(await screen.findByRole("button", { name: "Check Google, then review a corrected PIN" })).toHaveClass("whitespace-normal", "h-auto", "max-w-full")
  })
})

describe("reviewed PIN completion", () => {
  it("clears preview credentials, requires approval and re-entry, and keeps leading zeros", async () => {
    const { client } = fixture(); await approve()
    expect(previewGoogleVerificationCompletion).toHaveBeenCalledExactlyOnceWith(locationId, { name: request.name, pin: "001234" })
    expect(executeGoogleVerificationCompletion).not.toHaveBeenCalled()
    expect(screen.getByLabelText("Re-enter reviewed PIN")).toHaveValue("")
    expect(screen.getByRole("button", { name: "Send approved PIN" })).toBeDisabled()
    await send()
    expect(await screen.findByText("Google accepted the request")).toBeInTheDocument()
    expect(screen.getByText("Confirmation unresolved")).toBeInTheDocument()
    expect(screen.queryByText("Verification completed")).not.toBeInTheDocument()
    expect(executeGoogleVerificationCompletion).toHaveBeenCalledExactlyOnceWith(locationId, reviewId, hash, "001234")
    expect(JSON.stringify(client.getQueryCache().getAll().map((query) => [query.queryKey, query.state.data]))).not.toContain("001234")
    expect(client.getMutationCache().getAll()).toHaveLength(0)
  })
  it("requires a second manager's approval without restoring a PIN", async () => {
    vi.mocked(previewGoogleVerificationCompletion).mockResolvedValue({ ...review, changeSet: { ...review.changeSet, requiresSecondApprover: true, canApprove: false } })
    fixture(); await preview()
    expect(screen.getByRole("button", { name: "Approve PIN completion" })).toBeDisabled()
    expect(screen.queryByLabelText("Re-enter reviewed PIN")).not.toBeInTheDocument()
    expect(screen.getByText(/different authorised owner or admin/)).toBeInTheDocument()
    expect(executeGoogleVerificationCompletion).not.toHaveBeenCalled()
  })
  it("requires a fresh review after the PIN binding changes", async () => {
    vi.mocked(executeGoogleVerificationCompletion).mockRejectedValue(new ApiClientError(409, "verification_pin_changed", "untrusted private echo"))
    fixture(); await approve(); await send("999999")
    expect(await screen.findByText(/PIN differs from the reviewed PIN/)).toBeInTheDocument()
    expect(screen.queryByText("untrusted private echo")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Send approved PIN" })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Create a fresh PIN review" }))
    expect(screen.getByLabelText("PIN from Google")).toHaveValue("")
    expect(executeGoogleVerificationCompletion).toHaveBeenCalledTimes(1)
  })
  it("clears an interrupted send and recovers through a read without resubmission", async () => {
    vi.mocked(executeGoogleVerificationCompletion).mockRejectedValue(new TypeError("lost send"))
    fixture(); await approve(); await send()
    expect(await screen.findByText(/send response was unavailable/)).toBeInTheDocument()
    expect(screen.getByLabelText("Re-enter reviewed PIN")).toHaveValue("")
    expect(screen.getByRole("button", { name: "Send approved PIN" })).toBeDisabled()
    await userEvent.click(screen.getByRole("button", { name: "Check saved PIN outcome" }))
    expect(await screen.findByText("Confirmation unresolved")).toBeInTheDocument()
    expect(fetchGoogleVerificationCompletionAttempt).toHaveBeenCalledExactlyOnceWith(locationId, reviewId)
    expect(executeGoogleVerificationCompletion).toHaveBeenCalledTimes(1)
  })
  it("keeps an active PIN request distinct from a finished unavailable response", async () => {
    let finish: ((value: typeof attempt) => void) | undefined
    vi.mocked(executeGoogleVerificationCompletion).mockReturnValue(new Promise((resolve) => { finish = resolve }))
    fixture(); await approve(); await send()
    expect(screen.getByRole("button", { name: "Request action in progress…" })).toHaveAttribute("aria-disabled", "true")
    await userEvent.click(screen.getByRole("button", { name: "Request action in progress…" }))
    expect(executeGoogleVerificationCompletion).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/send response was unavailable/)).not.toBeInTheDocument()
    finish?.(attempt)
    expect(await screen.findByText("Google accepted the request")).toBeInTheDocument()
  })
  it("blocks the old PIN review after authoritative expiry and permits a fresh review", async () => {
    fixture(); await approve()
    await userEvent.type(screen.getByLabelText("Re-enter reviewed PIN"), "001234")
    vi.mocked(fetchGoogleVerificationCompletionReview).mockRejectedValue(new ApiClientError(409, "approval_expired", "private echo"))
    await userEvent.click(screen.getByRole("button", { name: "Refresh exact PIN review" }))
    await screen.findByText(/This review has expired/)
    expect(screen.queryByRole("button", { name: "Send approved PIN" })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Create a fresh PIN review" }))
    expect(screen.getByLabelText("PIN from Google")).toHaveValue("")
    expect(executeGoogleVerificationCompletion).not.toHaveBeenCalled()
  })
  it("restores an approved team review after reload with an empty PIN field", async () => {
    const first = fixture(); await approve(); await userEvent.type(screen.getByLabelText("Re-enter reviewed PIN"), "001234"); first.view.unmount()
    vi.mocked(fetchGoogleVerificationWorkflows).mockResolvedValue({ workflows: [{ ...workflow, approvedBy: locationId }], nextCursor: null })
    fixture([]); await userEvent.click(await screen.findByRole("button", { name: "Open saved review" }))
    expect(await screen.findByLabelText("Re-enter reviewed PIN")).toHaveValue("")
    expect(screen.getByRole("button", { name: "Send approved PIN" })).toBeDisabled()
    expect(fetchGoogleVerificationCompletionReview).toHaveBeenCalledWith(locationId, reviewId)
    expect(executeGoogleVerificationCompletion).not.toHaveBeenCalled()
  })
  it("clears a re-entered PIN when the exact review is refreshed", async () => {
    fixture(); await approve(); await userEvent.type(screen.getByLabelText("Re-enter reviewed PIN"), "001234")
    await userEvent.click(screen.getByRole("button", { name: "Refresh exact PIN review" }))
    await waitFor(() => expect(screen.getByLabelText("Re-enter reviewed PIN")).toHaveValue(""))
    expect(executeGoogleVerificationCompletion).not.toHaveBeenCalled()
  })
  it("opens an expired recorded outcome while writes are paused without fetching its review", async () => {
    vi.mocked(fetchGoogleVerificationWorkflows).mockResolvedValue({ workflows: [{ ...workflow, expiresAt: "2020-01-01T00:00:00Z", reviewReason: "expired", attempt: { id: reviewId, status: "ambiguous", executionState: "accepted", confirmationState: "unresolved", observedAt: attempt.observedAt } }], nextCursor: null })
    fixture([], true); await userEvent.click(await screen.findByRole("button", { name: "Open saved outcome" }))
    expect(await screen.findByText("Confirmation unresolved")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Refresh saved outcome" }))
    expect(await screen.findByText(/earlier evidence, not a fresh observation/)).toBeInTheDocument()
    expect(fetchGoogleVerificationCompletionReview).not.toHaveBeenCalled()
    expect(executeGoogleVerificationCompletion).not.toHaveBeenCalled()
  })
  it("shows definitive rejection and permits a fresh corrected review rather than replay", async () => {
    vi.mocked(executeGoogleVerificationCompletion).mockResolvedValue({ ...attempt, status: "failed", executionState: "rejected", confirmationState: "unrecorded", error: "completion_rejected" })
    fixture(); await approve(); await send()
    expect(await screen.findByText("Google rejected the request")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Check Google, then review a corrected PIN" }))
    expect(screen.getByLabelText("PIN from Google")).toHaveValue("")
    expect(executeGoogleVerificationCompletion).toHaveBeenCalledTimes(1)
  })
  it.each(["AUTO", "VETTED_PARTNER", "FUTURE_METHOD", null])("hands off pending %s instead of presenting PIN entry", (method) => {
    fixture([{ ...request, method }])
    expect(screen.queryByLabelText("PIN from Google")).not.toBeInTheDocument()
    expect(screen.getByText(/cannot accept a PIN here/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Continue verification in Google" })).toHaveAttribute("href", "https://business.google.com/")
  })
  it("blocks PIN preview while publishing is paused", () => {
    fixture([request], true)
    expect(screen.getByLabelText("PIN from Google")).toBeDisabled()
    expect(screen.getByRole("button", { name: "Review PIN completion" })).toBeDisabled()
    expect(previewGoogleVerificationCompletion).not.toHaveBeenCalled()
  })
  it.each(["EMAIL", "PHONE_CALL", "SMS", "ADDRESS"] as const)("previews a pending %s PIN against the exact resource", async (method) => {
    vi.mocked(previewGoogleVerificationCompletion).mockResolvedValue({ ...review, verification: { ...request, method }, payload: { ...review.payload, method } })
    fixture([{ ...request, method }]); await preview(" 001234 ")
    expect(previewGoogleVerificationCompletion).toHaveBeenCalledExactlyOnceWith(locationId, { name: request.name, pin: "001234" })
    expect(executeGoogleVerificationCompletion).not.toHaveBeenCalled()
  })
  it("does not present an expired review for approval or PIN submission", async () => {
    vi.mocked(previewGoogleVerificationCompletion).mockResolvedValue({ ...review, changeSet: { ...review.changeSet, approvedBy: locationId, expiresAt: "2020-01-01T00:00:00Z" } })
    fixture(); await userEvent.type(screen.getByLabelText("PIN from Google"), "001234"); await userEvent.click(screen.getByRole("button", { name: "Review PIN completion" }))
    expect(await screen.findByText(/PIN approval has expired/)).toBeInTheDocument()
    expect(screen.getByText(`Approval expired at ${new Date("2020-01-01T00:00:00Z").toLocaleString("en-GB")}.`)).toBeInTheDocument()
    expect(screen.queryByText(/Approval expires/)).not.toBeInTheDocument()
    expect(screen.queryByText("This PIN completion is approved.")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Approve PIN completion" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Send approved PIN" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Check saved PIN outcome" })).toBeEnabled()
    expect(executeGoogleVerificationCompletion).not.toHaveBeenCalled()
  })
  it("clears a PIN when preview fails and never renders the error's private echo", async () => {
    vi.mocked(previewGoogleVerificationCompletion).mockRejectedValue(new ApiClientError(409, "verification_state_changed", "echo 001234"))
    fixture(); await userEvent.type(screen.getByLabelText("PIN from Google"), "001234"); await userEvent.click(screen.getByRole("button", { name: "Review PIN completion" }))
    expect(await screen.findByText(/Google verification changed after review/)).toBeInTheDocument()
    expect(screen.getByLabelText("PIN from Google")).toHaveValue("")
    expect(screen.queryByText("echo 001234")).not.toBeInTheDocument()
    expect(executeGoogleVerificationCompletion).not.toHaveBeenCalled()
  })
  it("refreshes current requests independently and removes PIN entry after completion", async () => {
    fixture(); await userEvent.click(screen.getByRole("button", { name: "Check current Google verification state" }))
    expect(await screen.findByText(/Current requests last checked/)).toBeInTheDocument()
    expect(screen.queryByLabelText("PIN from Google")).not.toBeInTheDocument()
    expect(fetchGoogleVerificationState).toHaveBeenCalledTimes(1)
    expect(executeGoogleVerificationCompletion).not.toHaveBeenCalled()
  })
})
