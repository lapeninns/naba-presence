import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AdministrationProvider } from "@/components/locations/administration/context"
import { DangerZone } from "@/components/locations/administration/danger-zone"
import { LifecycleWorkspace, useLifecycleContext } from "@/components/locations/administration/lifecycle-workspace"
import * as lifecycle from "@/lib/api/google-lifecycle"
import { lifecycleAttemptFixture, lifecycleFixtureId as id, lifecycleReviewFixture } from "../helpers/lifecycle-review"
import { renderWithProviders } from "../helpers/render"

vi.mock("@/lib/api/google-lifecycle", () => ({ previewLifecycle: vi.fn(), fetchLifecycleReview: vi.fn(), approveLifecycle: vi.fn(), executeLifecycle: vi.fn(), fetchLifecycleAttempt: vi.fn(), refreshLifecycleAttempt: vi.fn(), fetchLifecycleWorkflows: vi.fn() }))
vi.mock("@/lib/queries/use-session", () => ({ useSessionRole: () => "owner" }))
vi.mock("@/lib/queries/use-locations", () => ({ useLocationDirectory: () => ({ data: [{ id, name: "Camden Hotel" }] }) }))
vi.mock("@/lib/queries/use-location-capabilities", () => ({ useLocationCapabilities: () => ({ data: { canEditCanonical: true, canPublish: true } }) }))
beforeEach(() => {
  vi.resetAllMocks()
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
  await userEvent.click(screen.getByRole("button", { name: "Delete this location" }))
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
})
