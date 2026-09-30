import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { VerificationTab } from "@/components/locations/administration/verification-tab"
import { fetchSession } from "@/lib/api/session"
import { fetchLocationCapabilities } from "@/lib/api/locations"
import { fetchGoogleVerificationState } from "@/lib/api/google-verification-state"
import { fetchGoogleVerificationWorkflows } from "@/lib/api/google-verification-workflows"
import { fetchGoogleVerificationCompletionAttempt } from "@/lib/api/google-verification-completion-attempt"
import { fetchGoogleVerificationCompletionReview } from "@/lib/api/google-verification-completion-reviews"
import { fetchGoogleVerificationReview } from "@/lib/api/google-verification-reviews"
import type { VerificationReview } from "@/lib/contracts/google-verification-review"
import { ApiClientError } from "@/lib/api/client"
import type { VerificationStateResponse } from "@/lib/contracts/google-verification-state"
import type { SessionResponse } from "@/lib/contracts/session"
import { queryKeys } from "@/lib/queries/keys"
import { completionLocationId as locationId, completionRequest as request, completionAttempt as attempt, completionWorkflow as workflow, completionReview as pinReview } from "../helpers/verification-completion"

vi.mock("@/lib/api/session")
vi.mock("@/lib/api/locations")
vi.mock("@/lib/api/google-verification-state")
vi.mock("@/lib/api/google-verification-workflows")
vi.mock("@/lib/api/google-verification-completion-attempt")
vi.mock("@/lib/api/google-verification-completion-reviews")
vi.mock("@/lib/api/google-verification-reviews")

const session: SessionResponse = { session: { userId: "manager", organisationId: "org", organisationName: "Agency", displayName: "Manager", email: "manager@example.test", role: "owner", canPublish: true } }
const state: VerificationStateResponse = { locationId, googleLocationName: "locations/camden", checkedAt: "2026-09-30T01:00:00Z", verifications: [request], merchant: { hasVoiceOfMerchant: false, hasBusinessAuthority: true, action: "verify", hasPendingVerification: true }, merchantError: null }
beforeEach(() => {
  vi.mocked(fetchSession).mockResolvedValue(session)
  vi.mocked(fetchLocationCapabilities).mockResolvedValue({ canEditCanonical: true, canPublish: true, resources: { administration: { state: "available" } } })
  vi.mocked(fetchGoogleVerificationState).mockResolvedValue(state)
  vi.mocked(fetchGoogleVerificationWorkflows).mockResolvedValue({ workflows: [], nextCursor: null })
  vi.mocked(fetchGoogleVerificationCompletionAttempt).mockResolvedValue(attempt)
})
afterEach(() => vi.resetAllMocks())

function fixture() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(<QueryClientProvider client={client}><VerificationTab locationId={locationId} locationName="Camden Hotel" /></QueryClientProvider>)
  return { client, view }
}

describe("independent verification workspace", () => {
  it("retains both saved reviews with one active Google action bar", async () => {
    const startReview: VerificationReview = { changeSet: { ...pinReview.changeSet, id: "00000000-0000-4000-8000-000000000003", approvedBy: locationId }, payload: { method: "EMAIL", languageCode: "en-GB", emailAddress: "owner@example.test" }, choice: { id: pinReview.changeSet.payloadHash, kind: "email", method: "EMAIL", user: "owner", domain: "example.test", userNameEditable: true } }
    vi.mocked(fetchGoogleVerificationReview).mockResolvedValue(startReview)
    vi.mocked(fetchGoogleVerificationCompletionReview).mockResolvedValue({ ...pinReview, changeSet: { ...pinReview.changeSet, approvedBy: locationId } })
    vi.mocked(fetchGoogleVerificationWorkflows).mockImplementation(async (_id, query) => ({ workflows: [{ ...workflow, operation: query?.operation === "complete" ? "complete_verification" : "start_verification", reviewId: query?.operation === "complete" ? workflow.reviewId : startReview.changeSet.id, approvedBy: locationId }], nextCursor: null }))
    const { view } = fixture()
    await userEvent.click(await within(await screen.findByRole("region", { name: "Saved PIN completions" })).findByRole("button", { name: "Open saved review" }))
    await userEvent.type(await screen.findByLabelText("Re-enter reviewed PIN"), "001234")
    await userEvent.click(await within(screen.getByRole("region", { name: "Saved verification requests" })).findByRole("button", { name: "Open saved review" }))
    await screen.findByRole("button", { name: "Send approved verification request" })
    expect(view.container.querySelectorAll('[data-slot="action-bar"]')).toHaveLength(1)
    expect(screen.queryByLabelText("Re-enter reviewed PIN")).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Continue approved PIN completion" }))
    expect(screen.getByLabelText("Re-enter reviewed PIN")).toHaveValue("")
    expect(view.container.querySelectorAll('[data-slot="action-bar"]')).toHaveLength(1)
    expect(screen.getByText("owner@example.test")).toBeInTheDocument()
  })
  it("loads typed request and merchant observations without the legacy bundle", async () => {
    const fetchMock = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", fetchMock)
    try {
      fixture()
      expect(await screen.findByText("Google does not report voice of merchant")).toBeInTheDocument()
      expect(screen.getByRole("heading", { name: "Start a new verification" })).toBeInTheDocument()
      expect(screen.getByLabelText("PIN from Google")).toBeEnabled()
      expect(screen.queryByText(/Edits publish normally/)).not.toBeInTheDocument()
      expect(fetchMock).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })
  it.each(["member", "viewer"] as const)("does not issue privileged reads for a %s", async (role) => {
    vi.mocked(fetchSession).mockResolvedValue({ session: session.session && { ...session.session, role } })
    fixture()
    await screen.findByText("Only owners and admins can manage verification")
    expect(fetchGoogleVerificationState).not.toHaveBeenCalled()
    expect(fetchGoogleVerificationWorkflows).not.toHaveBeenCalled()
    expect(fetchLocationCapabilities).not.toHaveBeenCalled()
  })
  it("waits for a known session before privileged reads", async () => {
    let resolveSession: ((value: SessionResponse) => void) | undefined
    vi.mocked(fetchSession).mockReturnValue(new Promise((resolve) => { resolveSession = resolve }))
    fixture()
    expect(fetchGoogleVerificationState).not.toHaveBeenCalled()
    expect(fetchGoogleVerificationWorkflows).not.toHaveBeenCalled()
    resolveSession?.(session)
    await screen.findByLabelText("PIN from Google")
  })
  it("does not use a stale role after the session refresh fails", async () => {
    const { client } = fixture(); await screen.findByLabelText("PIN from Google")
    vi.mocked(fetchSession).mockRejectedValue(new Error("private provider echo"))
    await client.refetchQueries({ queryKey: queryKeys.session })
    await screen.findByText("Your access could not be checked")
    expect(screen.queryByLabelText("PIN from Google")).not.toBeInTheDocument()
    expect(screen.queryByText("private provider echo")).not.toBeInTheDocument()
  })
  it("keeps saved outcomes accessible when Google is disconnected", async () => {
    vi.mocked(fetchGoogleVerificationState).mockRejectedValue(new ApiClientError(409, "google_reconnect_required", "private provider echo"))
    vi.mocked(fetchGoogleVerificationWorkflows).mockImplementation(async (_id, query) => ({ workflows: query?.operation === "complete" ? [{ ...workflow, attempt: { id: attempt.id, status: attempt.status, executionState: attempt.executionState, confirmationState: attempt.confirmationState, observedAt: attempt.observedAt } }] : [], nextCursor: null }))
    fixture()
    await screen.findByText("Current Google state could not be read")
    expect(screen.getByText(/This does not mean the listing is unverified/)).toBeInTheDocument()
    await userEvent.click(await screen.findByRole("button", { name: "Open saved outcome" }))
    expect(await screen.findByText("Google accepted the request")).toBeInTheDocument()
    expect(screen.getByText("Confirmation unresolved")).toBeInTheDocument()
    expect(fetchGoogleVerificationCompletionAttempt).toHaveBeenCalled()
    expect(screen.queryByText("private provider echo")).not.toBeInTheDocument()
  })
  it("keeps recovery mounted and blocks sends when capabilities fail", async () => {
    vi.mocked(fetchLocationCapabilities).mockRejectedValue(new Error("private echo"))
    fixture()
    await screen.findByRole("button", { name: "Check publishing permissions again" })
    expect(await screen.findByLabelText("PIN from Google")).toBeDisabled()
    expect(screen.getByRole("heading", { name: "Saved verification requests" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Saved PIN completions" })).toBeInTheDocument()
  })
  it("fails closed when per-resource availability is missing", async () => {
    vi.mocked(fetchLocationCapabilities).mockResolvedValue({ canEditCanonical: true, canPublish: true })
    fixture()
    await screen.findAllByText(/Verification publishing availability has not been confirmed/)
    expect(await screen.findByLabelText("PIN from Google")).toBeDisabled()
  })
  it("shows completed requests without turning unknown standing into success", async () => {
    vi.mocked(fetchGoogleVerificationState).mockResolvedValue({ ...state, verifications: [{ ...request, phase: "completed", providerState: "COMPLETED" }], merchant: null, merchantError: "verification_merchant_state_unavailable" })
    fixture()
    await screen.findByText("Merchant standing is unknown")
    expect(screen.getByText("Request completed")).toBeInTheDocument()
    expect(screen.queryByText(/Google has verified/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText("PIN from Google")).not.toBeInTheDocument()
  })
  it("retains dated observations after a failed refresh and blocks new sends", async () => {
    fixture(); await screen.findByLabelText("PIN from Google")
    vi.mocked(fetchGoogleVerificationState).mockRejectedValue(new Error("private echo"))
    await userEvent.click(screen.getByRole("button", { name: "Check current Google verification state" }))
    await screen.findByText(/The details below are earlier observations/)
    expect(screen.getByLabelText("PIN from Google")).toBeDisabled()
    expect(screen.getAllByText("Pending with Google")).toHaveLength(2)
  })
  it("dates History so an empty list never reads as contradicting a newer saved outcome", async () => {
    vi.mocked(fetchGoogleVerificationState).mockResolvedValue({ ...state, verifications: [] })
    fixture()
    const checked = new Date(state.checkedAt).toLocaleString("en-GB")
    expect(await screen.findByText(new RegExp(`Google returned no verification requests when this list was checked at ${checked}`))).toBeInTheDocument()
    expect(screen.getByText(/A saved outcome above may have been observed after that check/)).toBeInTheDocument()
    expect(screen.getByText(`Requests Google returned when checked at ${checked}. Saved outcomes above can be newer than this check; completion does not establish current merchant standing.`)).toBeInTheDocument()
    expect(screen.queryByText(/at the last successful check/)).not.toBeInTheDocument()
  })
  it("labels each saved list's reload control once, with no duplicate generic control", async () => {
    fixture(); await screen.findByLabelText("PIN from Google")
    expect(screen.getAllByRole("button", { name: "Reload saved start requests" })).toHaveLength(1)
    expect(screen.getAllByRole("button", { name: "Reload saved PIN completions" })).toHaveLength(1)
    expect(screen.queryByRole("button", { name: "Reload saved requests" })).not.toBeInTheDocument()
  })
  it("humanises an unknown verification method and keeps its code as secondary detail", async () => {
    vi.mocked(fetchGoogleVerificationState).mockResolvedValue({ ...state, verifications: [{ ...request, method: "FUTURE_METHOD", phase: "completed", providerState: "COMPLETED" }] })
    fixture()
    expect(await screen.findByText("Another Google method")).toBeInTheDocument()
    expect(screen.getByText("Google method code: FUTURE_METHOD")).toBeInTheDocument()
    expect(screen.queryByText("FUTURE METHOD")).not.toBeInTheDocument()
  })
  it("never lists an expired approved review as approved", async () => {
    vi.mocked(fetchGoogleVerificationWorkflows).mockImplementation(async (_id, query) => ({ workflows: query?.operation === "complete" ? [
      { ...workflow, approvedBy: locationId, expiresAt: "2020-01-01T00:00:00Z" },
      { ...workflow, reviewId: "00000000-0000-4000-8000-000000000009", approvedBy: locationId, expiresAt: "2099-01-01T00:00:00Z", reviewReason: "expired" },
      { ...workflow, reviewId: "00000000-0000-4000-8000-000000000010", expiresAt: "2020-01-01T00:00:00Z" },
    ] : [], nextCursor: null }))
    fixture()
    const saved = await screen.findByRole("region", { name: "Saved PIN completions" })
    expect(await within(saved).findAllByText("Text message · Approval expired")).toHaveLength(2)
    expect(within(saved).getByText("Text message · Review expired")).toBeInTheDocument()
    expect(within(saved).queryByText(/Approved review/)).not.toBeInTheDocument()
  })
  it("removes transient PIN controls on role revocation", async () => {
    const { client } = fixture(); await screen.findByLabelText("PIN from Google")
    await userEvent.type(screen.getByLabelText("PIN from Google"), "001234")
    client.setQueryData(queryKeys.session, { session: session.session && { ...session.session, role: "viewer" } })
    await screen.findByText("Only owners and admins can manage verification")
    expect(screen.queryByLabelText("PIN from Google")).not.toBeInTheDocument()
    expect(JSON.stringify(client.getQueryCache().getAll().map((entry) => entry.state.data))).not.toContain("001234")
  })
})
