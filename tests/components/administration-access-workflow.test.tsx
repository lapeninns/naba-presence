import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AdministrationProvider } from "@/components/locations/administration/context"
import { AdministrationAccessWorkspace, useAdministrationAccess } from "@/components/locations/administration/access-workspace"
import { DangerZone } from "@/components/locations/administration/danger-zone"
import * as access from "@/lib/api/google-administration-access"
import { ApiClientError } from "@/lib/api/client"
import type { AdministrationAccessAttempt } from "@/lib/contracts/google-administration-attempt"
import { administrationReviewFixture } from "../helpers/administration-access-review"
import { renderWithProviders } from "../helpers/render"

vi.mock("@/lib/api/google-administration-access")
const review = administrationReviewFixture({ operation: "create_admin", payload: { scope: "location", admin: "new@example.test", role: "MANAGER" } })
const id = review.changeSet.id
const approved = { ...review, changeSet: { ...review.changeSet, approvedBy: "manager" } }
const outcome: AdministrationAccessAttempt = { id, reviewId: id, payloadHash: review.changeSet.payloadHash, request: review.request, target: review.target, status: "succeeded", executionState: "accepted", confirmationState: "confirmed", idempotent: false, observation: null, postcondition: "administrator_present", pendingInvitation: true, error: null }
beforeEach(() => {
  vi.mocked(access.previewAdministrationAccess).mockResolvedValue(review)
  vi.mocked(access.approveAdministrationAccess).mockResolvedValue(approved)
  vi.mocked(access.fetchAdministrationAccessReview).mockResolvedValue(approved)
  vi.mocked(access.executeAdministrationAccess).mockResolvedValue(outcome)
  vi.mocked(access.fetchAdministrationAccessAttempt).mockResolvedValue(outcome)
  vi.mocked(access.refreshAdministrationAccessAttempt).mockResolvedValue(outcome)
  vi.mocked(access.fetchAdministrationAccessWorkflows).mockResolvedValue({ items: [], nextCursor: null })
})
afterEach(() => vi.resetAllMocks())
function PreviewControl() {
  const action = useAdministrationAccess()
  return <button disabled={action.busy || Boolean(action.unresolved)} onClick={() => { void action.preview(review.request).catch(() => {}) }}>Preview fixture access</button>
}
function render(blocked = false) { return renderWithProviders(<AdministrationProvider locationId={id} locationName="Camden Hotel" disabled={false} publishReason={blocked ? "Publishing paused" : null}><AdministrationAccessWorkspace><PreviewControl /><DangerZone /></AdministrationAccessWorkspace></AdministrationProvider>) }
async function approve() { await userEvent.click(screen.getByRole("button", { name: "Preview fixture access" })); await userEvent.click(await screen.findByRole("button", { name: "Approve access request" })); return screen.findByRole("button", { name: "Send approved access request" }) }
async function send() { const button = await approve(); await userEvent.click(screen.getByRole("checkbox")); await userEvent.click(button) }

describe("administration review, consent and saved outcome controls", () => {
  it("requires approval and explicit consent before one exact send and reports pending invitation truthfully", async () => {
    render(); const button = await approve()
    expect(button).toBeDisabled(); expect(access.executeAdministrationAccess).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("checkbox")); await userEvent.click(button)
    expect(await screen.findByText("Administrator invitation listed; access awaits acceptance")).toBeInTheDocument()
    expect(screen.getByText("Independently confirmed")).toBeInTheDocument()
    expect(access.executeAdministrationAccess).toHaveBeenCalledExactlyOnceWith(id, id, review.changeSet.payloadHash)
  })
  it("describes the Google target for people and keeps the exact resource name as a secondary reference", async () => {
    render(); await userEvent.click(screen.getByRole("button", { name: "Preview fixture access" }))
    expect(await screen.findByText("New invitation for new@example.test on this listing")).toBeInTheDocument()
    const reference = screen.getByText("Google reference: locations/camden/admins")
    expect(reference).toHaveClass("text-caption", "text-ink-muted", "break-all")
    expect(screen.queryByText("locations/camden/admins", { exact: true })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole("button", { name: "Approve access request" }))
    await userEvent.click(await screen.findByRole("checkbox"))
    await userEvent.click(screen.getByRole("button", { name: "Send approved access request" }))
    await screen.findByText("Independently confirmed")
    expect(screen.getByText("New invitation for new@example.test on this listing")).toBeInTheDocument()
    expect(screen.getByText("Google reference: locations/camden/admins")).toBeInTheDocument()
  })
  it("names the listed administrator for a removal and labels an invitation's role as offered, not held", async () => {
    const removal = administrationReviewFixture({ operation: "delete_admin", payload: { name: "locations/camden/admins/manager" } })
    const listedAdmin = { ...removal, changeSet: { ...removal.changeSet, baseline: { collection: "locations/camden/admins", rows: [{ name: "locations/camden/admins/manager", admin: "manager@example.test", role: "MANAGER" }] } } }
    vi.mocked(access.previewAdministrationAccess).mockResolvedValueOnce(listedAdmin)
    const view = render(); await userEvent.click(screen.getByRole("button", { name: "Preview fixture access" }))
    expect(await screen.findByText("Administrator manager@example.test on this listing")).toBeInTheDocument()
    expect(screen.getByText("Google reference: locations/camden/admins/manager")).toBeInTheDocument()
    expect(screen.getByText("Current role")).toBeInTheDocument()
    view.unmount()

    const accept = administrationReviewFixture({ operation: "accept_invitation", payload: { name: "accounts/stub-1/invitations/pending" } })
    const invited = { ...accept, changeSet: { ...accept.changeSet, baseline: { collection: "accounts/stub-1/invitations", rows: [{ name: "accounts/stub-1/invitations/pending", role: "MANAGER", targetLocation: { locationName: "Camden Hotel" } }] } } }
    vi.mocked(access.previewAdministrationAccess).mockResolvedValueOnce(invited)
    render(); await userEvent.click(screen.getByRole("button", { name: "Preview fixture access" }))
    expect(await screen.findByText("Invitation to manage Camden Hotel")).toBeInTheDocument()
    expect(screen.getByText("Google reference: accounts/stub-1/invitations/pending")).toBeInTheDocument()
    expect(screen.getByText("Invited role")).toBeInTheDocument()
    expect(screen.queryByText("Current role")).not.toBeInTheDocument()
  })
  it("clears consent when the same saved approved review is reopened", async () => {
    vi.mocked(access.fetchAdministrationAccessWorkflows).mockResolvedValue({ items: [{ reviewId: id, createdAt: review.observedAt, request: review.request, attemptId: null, executionState: null, confirmationState: null }], nextCursor: null })
    render(); await approve(); await userEvent.click(screen.getByRole("checkbox"))
    await userEvent.click(screen.getByRole("button", { name: "Open review" }))
    await waitFor(() => expect(screen.getByRole("checkbox")).not.toBeChecked())
    expect(screen.getByRole("button", { name: "Send approved access request" })).toBeDisabled()
    expect(access.executeAdministrationAccess).not.toHaveBeenCalled()
  })
  it("keeps unknown acknowledgement distinct from a confirmed postcondition and refreshes without a resend", async () => {
    vi.mocked(access.executeAdministrationAccess).mockResolvedValue({ ...outcome, executionState: "unknown" })
    vi.mocked(access.refreshAdministrationAccessAttempt).mockResolvedValue({ ...outcome, executionState: "unknown" })
    render(); await send(); expect(await screen.findByText("Google acknowledgement unknown")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Refresh Google access state" }))
    expect(access.refreshAdministrationAccessAttempt).toHaveBeenCalledExactlyOnceWith(id, id)
    expect(access.executeAdministrationAccess).toHaveBeenCalledTimes(1)
  })
  it("keeps unresolved work from enabling a new review or abandoning the recorded outcome", async () => {
    vi.mocked(access.executeAdministrationAccess).mockResolvedValue({ ...outcome, status: "ambiguous", executionState: "unknown", confirmationState: "unresolved", postcondition: "unknown", error: "outcome_unresolved" })
    render(); await send(); await screen.findByText("Outcome unresolved")
    expect(screen.getByRole("button", { name: "Preview fixture access" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Back to access" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Transfer this location" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Delete this location" })).toBeDisabled()
  })
  it("clears uncertainty only after an authoritative absent attempt and retains expired-review blocking", async () => {
    vi.mocked(access.executeAdministrationAccess).mockRejectedValue(new TypeError("lost response"))
    vi.mocked(access.fetchAdministrationAccessAttempt).mockRejectedValue(new ApiClientError(404, "administration_attempt_not_found", "absent"))
    vi.mocked(access.fetchAdministrationAccessReview).mockRejectedValue(new ApiClientError(409, "approval_expired", "This review expired."))
    render(); await send(); await screen.findByText(/send response was unavailable/)
    expect(screen.getByRole("button", { name: "Back to access" })).toBeDisabled()
    await userEvent.click(screen.getByRole("button", { name: "Check saved access outcome" }))
    await screen.findByText(/This review cannot be sent/)
    expect(screen.getByRole("button", { name: "Back to access" })).toBeEnabled()
    expect(access.executeAdministrationAccess).toHaveBeenCalledTimes(1)
  })
  it("honours the publish gate without sending", async () => {
    render(true); await userEvent.click(screen.getByRole("button", { name: "Preview fixture access" }))
    expect(await screen.findByRole("button", { name: "Approve access request" })).toBeDisabled()
    expect(access.executeAdministrationAccess).not.toHaveBeenCalled()
  })
  it("blocks adjacent lifecycle writes throughout an in-flight access request", async () => {
    let complete: ((value: AdministrationAccessAttempt) => void) | undefined
    vi.mocked(access.executeAdministrationAccess).mockImplementation(() => new Promise((resolve) => { complete = resolve }))
    render(); await send()
    expect(screen.getByRole("button", { name: "Transfer this location" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Delete this location" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Preview fixture access" })).toBeDisabled()
    expect(access.executeAdministrationAccess).toHaveBeenCalledTimes(1)
    complete?.(outcome)
    expect(await screen.findByText("Independently confirmed")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Transfer this location" })).toBeEnabled()
  })
})
