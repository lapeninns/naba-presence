import { QueryClient } from "@tanstack/react-query"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AdministrationProvider } from "@/components/locations/administration/context"
import { DangerZone } from "@/components/locations/administration/danger-zone"
import { LifecycleWorkspace, useLifecycleContext } from "@/components/locations/administration/lifecycle-workspace"
import { formatInstant } from "@/components/editors/change-diff"
import { ApiClientError } from "@/lib/api/client"
import * as lifecycle from "@/lib/api/google-lifecycle"
import { queryKeys } from "@/lib/queries/keys"
import { lifecycleAttemptFixture, lifecycleFixtureId as id, lifecycleReviewFixture } from "../helpers/lifecycle-review"
import { renderWithProviders } from "../helpers/render"

vi.mock("@/lib/api/google-lifecycle", () => ({ previewLifecycle: vi.fn(), fetchLifecycleReview: vi.fn(), approveLifecycle: vi.fn(), executeLifecycle: vi.fn(), fetchLifecycleAttempt: vi.fn(), refreshLifecycleAttempt: vi.fn(), fetchLifecycleWorkflows: vi.fn() }))
vi.mock("@/lib/queries/use-session", () => ({ useSessionRole: () => "owner" }))
vi.mock("@/lib/queries/use-locations", () => ({ useLocationDirectory: () => ({ data: [{ id, name: "Camden Hotel" }] }) }))
const capabilities = vi.hoisted(() => ({ current: { canEditCanonical: true, canPublish: true } }))
vi.mock("@/lib/queries/use-location-capabilities", () => ({ useLocationCapabilities: () => ({ data: capabilities.current }) }))
beforeEach(() => {
  vi.resetAllMocks()
  capabilities.current = { canEditCanonical: true, canPublish: true }
  const review = lifecycleReviewFixture()
  vi.mocked(lifecycle.previewLifecycle).mockResolvedValue(review)
  vi.mocked(lifecycle.approveLifecycle).mockResolvedValue({ ...review, changeSet: { ...review.changeSet, approvedBy: id } })
  vi.mocked(lifecycle.executeLifecycle).mockResolvedValue(lifecycleAttemptFixture())
  vi.mocked(lifecycle.fetchLifecycleAttempt).mockResolvedValue(lifecycleAttemptFixture())
  vi.mocked(lifecycle.fetchLifecycleWorkflows).mockResolvedValue({ items: [], nextCursor: null })
})
function AccessGuardControls() {
  const lifecycle = useLifecycleContext()
  return <><button onClick={() => lifecycle?.setAccessBlocked(true)}>Simulate unresolved access</button><button onClick={() => lifecycle?.setAccessBlocked(false)}>Confirm access outcome</button></>
}
function render() { return renderWithProviders(<AdministrationProvider locationId={id} locationName="Camden Hotel" disabled={false} publishReason={null}><LifecycleWorkspace locationId={id} locationName="Camden Hotel"><DangerZone /><AccessGuardControls /></LifecycleWorkspace></AdministrationProvider>) }
async function approve() {
  await userEvent.click(screen.getByRole("button", { name: "Request deletion" }))
  await userEvent.click(screen.getByRole("button", { name: "Prepare deletion review" }))
  await userEvent.click(await screen.findByRole("button", { name: "Approve lifecycle request" }))
  return screen.findByRole("button", { name: "Send approved deletion" })
}
async function consentAndSend() {
  const button = await approve()
  await userEvent.type(screen.getByLabelText("Type the listing name: Camden Hotel"), "Camden Hotel")
  await userEvent.click(screen.getByRole("checkbox", { name: "Send this exact approved lifecycle request to Google." }))
  await userEvent.click(button)
}
describe("typed reviewed lifecycle workflow", () => {
  it("blocks an approved lifecycle send while access is unresolved and resets consent after recovery", async () => {
    render(); const button = await approve()
    await userEvent.type(screen.getByLabelText("Type the listing name: Camden Hotel"), "Camden Hotel")
    await userEvent.click(screen.getByRole("checkbox")); expect(button).toBeEnabled()
    await userEvent.click(screen.getByRole("button", { name: "Simulate unresolved access" }))
    expect(button).toBeDisabled(); expect(lifecycle.executeLifecycle).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "Confirm access outcome" }))
    expect(button).toBeDisabled(); expect(screen.getByRole("checkbox")).not.toBeChecked()
    expect(screen.getByLabelText("Type the listing name: Camden Hotel")).toHaveValue("")
  })
  it("requires approval, exact typed name and separate consent before one deletion send", async () => {
    render(); const button = await approve()
    expect(lifecycle.previewLifecycle).toHaveBeenCalledExactlyOnceWith(id, { operation: "delete_location", payload: {} })
    expect(lifecycle.executeLifecycle).not.toHaveBeenCalled(); expect(button).toBeDisabled()
    await userEvent.type(screen.getByLabelText("Type the listing name: Camden Hotel"), "Camden Hote")
    await userEvent.click(screen.getByRole("checkbox")); expect(button).toBeDisabled()
    await userEvent.type(screen.getByLabelText("Type the listing name: Camden Hotel"), "l")
    expect(button).toBeEnabled(); await userEvent.click(button)
    expect(await screen.findByText("Independently confirmed")).toBeInTheDocument()
    expect(screen.getByText(/Search\/Maps removal and customer-review deletion are not confirmed/)).toBeInTheDocument()
    expect(lifecycle.executeLifecycle).toHaveBeenCalledExactlyOnceWith(id, id, "a".repeat(64))
  })
  it("matches the typed name exactly after trimming, with identifier keyboard hints", async () => {
    render(); const button = await approve()
    const name = screen.getByLabelText("Type the listing name: Camden Hotel")
    expect(name).toHaveAttribute("autocapitalize", "none"); expect(name).toHaveAttribute("autocorrect", "off"); expect(name).toHaveAttribute("spellcheck", "false")
    await userEvent.click(screen.getByRole("checkbox"))
    await userEvent.type(name, "camden hotel"); expect(button).toBeDisabled()
    await userEvent.clear(name); await userEvent.type(name, "  Camden Hotel "); expect(button).toBeEnabled()
    expect(lifecycle.executeLifecycle).not.toHaveBeenCalled()
  })
  it("moves focus to the review once it is prepared, and to the outcome once it is recorded", async () => {
    render()
    await userEvent.click(screen.getByRole("button", { name: "Request deletion" }))
    await userEvent.click(screen.getByRole("button", { name: "Prepare deletion review" }))
    const heading = await screen.findByRole("heading", { name: "Review managed-location deletion" })
    await waitFor(() => expect(heading).toHaveFocus())
    await userEvent.click(screen.getByRole("button", { name: "Approve lifecycle request" }))
    await userEvent.type(await screen.findByLabelText("Type the listing name: Camden Hotel"), "Camden Hotel")
    // Approval did not pull focus away from the name being typed.
    expect(screen.getByLabelText("Type the listing name: Camden Hotel")).toHaveFocus()
    await userEvent.click(screen.getByRole("checkbox", { name: "Send this exact approved lifecycle request to Google." }))
    await userEvent.click(screen.getByRole("button", { name: "Send approved deletion" }))
    const outcome = await screen.findByRole("heading", { name: "Saved lifecycle outcome" })
    await waitFor(() => expect(outcome).toHaveFocus())
  })
  it("reads a lost acknowledgement without another lifecycle send", async () => {
    vi.mocked(lifecycle.executeLifecycle).mockRejectedValue(new TypeError("lost response"))
    render(); await consentAndSend()
    await screen.findByText("The send response is unavailable. Read the saved outcome before another lifecycle write.")
    expect(screen.getByRole("button", { name: "Transfer this location" })).toBeDisabled()
    await userEvent.click(screen.getByRole("button", { name: "Read saved lifecycle outcome" }))
    expect(await screen.findByText("Independently confirmed")).toBeInTheDocument()
    expect(lifecycle.executeLifecycle).toHaveBeenCalledTimes(1)
  })
  it("keeps an accepted but unresolved deletion guarded while a separate refresh reads Google", async () => {
    vi.mocked(lifecycle.executeLifecycle).mockResolvedValue({ ...lifecycleAttemptFixture(), confirmationState: "unresolved", postcondition: "unresolved" })
    vi.mocked(lifecycle.refreshLifecycleAttempt).mockResolvedValue(lifecycleAttemptFixture())
    render(); await consentAndSend(); await screen.findByText("Independent confirmation unresolved")
    expect(screen.getByRole("button", { name: "Transfer this location" })).toBeDisabled()
    await userEvent.click(screen.getByRole("button", { name: "Refresh lifecycle observation" }))
    await waitFor(() => expect(screen.getByText("Independently confirmed")).toBeInTheDocument())
    expect(lifecycle.refreshLifecycleAttempt).toHaveBeenCalledExactlyOnceWith(id, id)
    expect(lifecycle.executeLifecycle).toHaveBeenCalledTimes(1)
  })
  it("shows reviewed instants in local time, human role names and the place ID as secondary detail", async () => {
    render(); await approve()
    const panel = screen.getByRole("region", { name: "Review managed-location deletion" })
    expect(panel).not.toHaveTextContent(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
    expect(panel).not.toHaveTextContent(/OWNER|MANAGER/)
    expect(within(panel).getByText(/accounts\/source · Owner/)).toBeInTheDocument()
    // The place ID and location resource name are technical details, collapsed under the human summary.
    const placeId = within(panel).getByText("ChIJ_owned_fixture", { exact: true })
    const details = placeId.closest("details")
    expect(details).not.toBeNull(); expect(details).not.toHaveAttribute("open")
    expect(within(details as HTMLElement).getByText("Google place ID")).toBeInTheDocument()
    expect(within(details as HTMLElement).getByText("locations/hotel", { exact: true })).toBeInTheDocument()
    const observed = within(panel).getByText(formatInstant("2026-09-30T08:00:00.000Z"))
    expect(observed.tagName).toBe("TIME"); expect(observed).toHaveAttribute("dateTime", "2026-09-30T08:00:00.000Z")
    expect(within(panel).getByText(/^Approval expires/)).toBeInTheDocument()
  })
  it("shows the observation time locally on the outcome and refreshes the listing header state once confirmed", async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries")
    render(); await consentAndSend()
    const panel = await screen.findByRole("region", { name: "Saved lifecycle outcome" })
    expect(panel).not.toHaveTextContent(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
    expect(within(panel).getByText(formatInstant("2026-09-30T08:01:00.000Z"))).toHaveAttribute("dateTime", "2026-09-30T08:01:00.000Z")
    const keys = invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey))
    expect(keys).toContain(JSON.stringify(queryKeys.listingSummary(id)))
    expect(keys).toContain(JSON.stringify(queryKeys.listingSummaries))
    expect(keys).toContain(JSON.stringify(queryKeys.locations))
    invalidate.mockRestore()
  })
  it("does not refresh the listing header state for an unresolved outcome", async () => {
    vi.mocked(lifecycle.executeLifecycle).mockResolvedValue({ ...lifecycleAttemptFixture(), confirmationState: "unresolved", postcondition: "unresolved" })
    const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries")
    render(); await consentAndSend(); await screen.findByText("Independent confirmation unresolved")
    expect(invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey))).not.toContain(JSON.stringify(queryKeys.listingSummary(id)))
    invalidate.mockRestore()
  })
  it("states a server-reported approval expiry as past, in local time, and starts a fresh review in place", async () => {
    vi.mocked(lifecycle.executeLifecycle).mockRejectedValue(new ApiClientError(409, "approval_expired", "This review expired. Generate a new review."))
    render(); await consentAndSend()
    const panel = screen.getByRole("region", { name: "Review managed-location deletion" })
    expect(await within(panel).findByText(/This approval has expired, so the request can no longer be sent/)).toBeInTheDocument()
    const expiry = within(panel).getByText(/^Approval expired · checked/)
    const checked = within(expiry).getByText((_, element) => element?.tagName === "TIME")
    expect(checked.getAttribute("dateTime")).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(checked).toHaveTextContent(formatInstant(checked.getAttribute("dateTime") ?? ""))
    expect(panel).not.toHaveTextContent(/Approval expires/)
    expect(within(panel).queryByText("Create a fresh lifecycle review before sending.")).not.toBeInTheDocument()
    expect(within(panel).getByRole("button", { name: "Send approved deletion" })).toBeDisabled()
    await userEvent.click(within(panel).getByRole("button", { name: "Start a fresh review" }))
    expect(await screen.findByRole("button", { name: "Approve lifecycle request" })).toBeEnabled()
    expect(lifecycle.previewLifecycle).toHaveBeenLastCalledWith(id, { operation: "delete_location", payload: {} })
    expect(lifecycle.previewLifecycle).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/This approval has expired/)).not.toBeInTheDocument()
    expect(lifecycle.executeLifecycle).toHaveBeenCalledTimes(1)
  })
  it("states a review whose deadline has passed with its recorded local time", async () => {
    const expiredAt = "2026-01-01T12:00:00.000Z", review = lifecycleReviewFixture()
    vi.mocked(lifecycle.previewLifecycle).mockResolvedValue({ ...review, changeSet: { ...review.changeSet, expiresAt: expiredAt } })
    render()
    await userEvent.click(screen.getByRole("button", { name: "Request deletion" }))
    await userEvent.click(screen.getByRole("button", { name: "Prepare deletion review" }))
    const panel = await screen.findByRole("region", { name: "Review managed-location deletion" })
    const expiry = within(panel).getByText(/^Review expired/)
    expect(within(expiry).getByText(formatInstant(expiredAt))).toHaveAttribute("dateTime", expiredAt)
    expect(within(panel).getByText(/This review has expired, so the request can no longer be approved/)).toBeInTheDocument()
    expect(within(panel).getByRole("button", { name: "Approve lifecycle request" })).toBeDisabled()
    expect(within(panel).getByRole("button", { name: "Start a fresh review" })).toBeEnabled()
  })
  it.each([
    ["destination_management_required", /The destination account's access on Google changed since this review/],
    ["google_baseline_stale", /The destination or source account's access on Google changed since this review/],
  ])("explains %s on a transfer, marks the reviewed role as not current and offers a fresh review", async (code, message) => {
    await transferDrift(code, message)
  })
})
describe("a refused review explains itself in its own dialog", () => {
  it("explains a destination the connected login can’t manage against the field, and leaves an open deletion review sendable", async () => {
    render(); const send = await approve()
    vi.mocked(lifecycle.previewLifecycle).mockRejectedValueOnce(new ApiClientError(409, "destination_management_required", "Google has not confirmed the access, exact account membership or eligibility needed for this lifecycle request. Refresh before reviewing again."))
    await userEvent.click(screen.getByRole("button", { name: "Transfer this location" }))
    const dialog = screen.getByRole("dialog", { name: "Transfer Camden Hotel to another Google account" })
    const destination = within(dialog).getByLabelText("Destination Google account")
    await userEvent.type(destination, "987654321")
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue to transfer review" }))
    expect(await within(dialog).findByText("The connected Google login needs owner or manager access to accounts/987654321 before the location can move there. No review was saved, and nothing was sent to Google.")).toBeInTheDocument()
    expect(destination).toHaveAttribute("aria-invalid", "true")
    expect(lifecycle.previewLifecycle).toHaveBeenLastCalledWith(id, { operation: "transfer_location", payload: { destinationAccount: "accounts/987654321" } })
    // Changing the destination clears the refusal.
    await userEvent.type(destination, "0")
    expect(within(dialog).queryByText(/needs owner or manager access/)).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }))
    await userEvent.click(await screen.findByRole("button", { name: "Discard changes" }))
    // The deletion review that was already open is untouched: not stale, still sendable.
    const panel = screen.getByRole("region", { name: "Review managed-location deletion" })
    expect(within(panel).queryByText(/changed since this review/)).not.toBeInTheDocument()
    expect(within(panel).queryByRole("button", { name: "Start a fresh review" })).not.toBeInTheDocument()
    expect(screen.queryByText(/Google has not confirmed the access/)).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText("Type the listing name: Camden Hotel"), "Camden Hotel")
    await userEvent.click(screen.getByRole("checkbox", { name: "Send this exact approved lifecycle request to Google." }))
    expect(send).toBeEnabled()
  })
  it("says why Google refused a deletion inside the deletion dialog, not behind it", async () => {
    vi.mocked(lifecycle.previewLifecycle).mockRejectedValueOnce(new ApiClientError(409, "deletion_eligibility_unproven", "Google has not confirmed the access, exact account membership or eligibility needed for this lifecycle request. Refresh before reviewing again."))
    render()
    await userEvent.click(screen.getByRole("button", { name: "Request deletion" }))
    const dialog = screen.getByRole("dialog", { name: "Request deletion of Camden Hotel" })
    await userEvent.click(within(dialog).getByRole("button", { name: "Prepare deletion review" }))
    const alert = await within(dialog).findByRole("alert")
    expect(alert).toHaveTextContent("Google doesn’t list this location as one the connected login can delete. No review was saved, and nothing was sent to Google.")
    expect(screen.getAllByRole("alert")).toHaveLength(1)
    expect(screen.queryByRole("region", { name: "Review managed-location deletion" })).not.toBeInTheDocument()
    // Reopening the dialog starts clean.
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }))
    await userEvent.click(await screen.findByRole("button", { name: "Request deletion" }))
    expect(within(screen.getByRole("dialog")).queryByRole("alert")).not.toBeInTheDocument()
  })
  it("names missing send permission as the reason sending waits", async () => {
    capabilities.current = { canEditCanonical: true, canPublish: false }
    vi.mocked(lifecycle.previewLifecycle).mockResolvedValue({ ...lifecycleReviewFixture(), changeSet: { ...lifecycleReviewFixture().changeSet, approvedBy: id } })
    render()
    await userEvent.click(screen.getByRole("button", { name: "Request deletion" }))
    await userEvent.click(screen.getByRole("button", { name: "Prepare deletion review" }))
    expect(await screen.findByText("Your current permissions don’t allow sending changes to Google for this listing.")).toBeInTheDocument()
    expect(screen.queryByText(/until the other Google change is resolved/)).not.toBeInTheDocument()
  })
})
describe("saved lifecycle work load failure copy", () => {
  const lead = "Saved lifecycle work could not be loaded."
  it("names a network failure when the read never reached the server", async () => {
    vi.mocked(lifecycle.fetchLifecycleWorkflows).mockRejectedValue(new TypeError("Failed to fetch"))
    render()
    expect(await screen.findByText(`${lead} We couldn’t reach NabaPresence. Check your connection and try again.`)).toBeInTheDocument()
    expect(screen.queryByText(/Check your current access/)).not.toBeInTheDocument()
  })
  it("asks the operator to try again after a server error, without blaming their access", async () => {
    vi.mocked(lifecycle.fetchLifecycleWorkflows).mockRejectedValue(new ApiClientError(503, "service_unavailable", "Unavailable."))
    render()
    expect(await screen.findByText(`${lead} Try again.`)).toBeInTheDocument()
    expect(screen.queryByText(/Check your current access/)).not.toBeInTheDocument()
  })
  it("keeps the access copy for a real permission refusal", async () => {
    vi.mocked(lifecycle.fetchLifecycleWorkflows).mockRejectedValue(new ApiClientError(403, "permission_denied", "Forbidden."))
    render()
    expect(await screen.findByText(`${lead} Check your current access.`)).toBeInTheDocument()
  })
})
async function transferDrift(code: string, message: RegExp) {
  const request = { operation: "transfer_location" as const, payload: { destinationAccount: "accounts/destination" } }
  const review = lifecycleReviewFixture(request)
  vi.mocked(lifecycle.previewLifecycle).mockResolvedValue(review)
  vi.mocked(lifecycle.approveLifecycle).mockResolvedValue({ ...review, changeSet: { ...review.changeSet, approvedBy: id } })
  vi.mocked(lifecycle.executeLifecycle).mockRejectedValue(new ApiClientError(409, code, "Access changed."))
  render()
  await userEvent.click(screen.getByRole("button", { name: "Transfer this location" }))
  await userEvent.type(screen.getByLabelText("Destination Google account"), "accounts/destination")
  await userEvent.click(screen.getByRole("button", { name: "Continue to transfer review" }))
  await userEvent.click(await screen.findByRole("button", { name: "Approve lifecycle request" }))
  const send = await screen.findByRole("button", { name: "Send approved transfer" })
  const panel = screen.getByRole("region", { name: "Review account transfer" })
  expect(within(panel).getByText("accounts/destination · Manager")).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText("Type the listing name: Camden Hotel"), "Camden Hotel")
  await userEvent.click(screen.getByRole("checkbox")); await userEvent.click(send)
  expect(await within(panel).findByText(message)).toBeInTheDocument()
  expect(within(panel).getByText("accounts/destination · Manager at review, no longer current")).toBeInTheDocument()
  expect(within(panel).queryByText("Create a fresh lifecycle review before sending.")).not.toBeInTheDocument()
  expect(send).toBeDisabled()
  await userEvent.click(within(panel).getByRole("button", { name: "Start a fresh review" }))
  await waitFor(() => expect(lifecycle.previewLifecycle).toHaveBeenCalledTimes(2))
  expect(lifecycle.previewLifecycle).toHaveBeenLastCalledWith(id, request)
  expect(await within(panel).findByText("accounts/destination · Manager")).toBeInTheDocument()
}
