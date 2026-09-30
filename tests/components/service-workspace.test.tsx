import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ServiceWorkspaceProvider, SavedServiceWorkspace } from "@/components/locations/profile/sections/service-workspace"
import { renderWithProviders } from "../helpers/render"

const review = { id: "11111111-1111-4111-8111-111111111111", locationName: "Fixture Clinic", targetResourceName: "locations/fixture", payloadHash: "b".repeat(64), baselineHash: "a".repeat(64), payload: { serviceItems: [] }, baseline: { serviceItems: [{ freeFormServiceItem: { category: "gcid:doctor", label: { displayName: "Consultation" } } }] }, updateMask: ["serviceItems"], requestedBy: "owner", approvedBy: "owner", requiresSecondApprover: false, canApprove: true, expiresAt: "2020-01-01T12:00:00Z" }
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe("saved general service discovery", () => {
  it("restores an expired recorded outcome while publishing is unavailable using only reads", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => String(url).includes("capabilities")
      ? response({ capabilities: { canEditCanonical: true, canPublish: false } })
      : String(url).includes("service_workflows") ? response({ items: [{ changeSet: review, attemptId: "22222222-2222-4222-8222-222222222222" }], nextCursor: null })
      : response({ attempt: { id: "22222222-2222-4222-8222-222222222222", reviewId: review.id, targetResourceName: "locations/fixture", status: "succeeded", idempotent: true, executionState: "unknown", confirmationState: "confirmed", createdAt: "2026-09-30T10:00:00Z", observedAt: "2026-09-30T10:01:00Z", errorCode: null } }))
    vi.stubGlobal("fetch", fetchMock)
    renderWithProviders(<ServiceWorkspaceProvider locationId="fixture"><SavedServiceWorkspace locationId="fixture" /></ServiceWorkspaceProvider>)
    await userEvent.click(await screen.findByRole("button", { name: "Open service outcome" }))
    expect(await screen.findByText("Independently confirmed")).toBeInTheDocument()
    expect(screen.getByText("Google acknowledgement unknown")).toBeInTheDocument()
    expect(screen.queryByText("2026-09-30T10:01:00Z")).not.toBeInTheDocument()
    expect(document.querySelector('time[datetime="2026-09-30T10:01:00Z"]')).toHaveTextContent(/30 Sep/)
    expect(screen.queryByRole("button", { name: "Send approved service changes" })).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true)
  })
  it("does not request privileged saved work without managerial access", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => response({ capabilities: { canEditCanonical: false, canPublish: false } }))
    vi.stubGlobal("fetch", fetchMock)
    renderWithProviders(<ServiceWorkspaceProvider locationId="fixture"><SavedServiceWorkspace locationId="fixture" /></ServiceWorkspaceProvider>)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByRole("region", { name: "Saved service work" })).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.every(([url]) => String(url).includes("capabilities"))).toBe(true)
  })
})
