import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { LodgingWorkspaceProvider, SavedLodgingWork } from "@/components/locations/profile/sections/lodging-workspace"
import { renderWithProviders } from "../helpers/render"

const changeSet = { id: "11111111-1111-4111-8111-111111111111", locationName: "Fixture Hotel", targetResourceName: "locations/fixture", payloadHash: "b".repeat(64), baselineHash: "a".repeat(64), payload: { pets: { petsAllowed: true } }, baseline: { pets: { petsAllowed: false } }, updateMask: ["pets.petsAllowed"], requestedBy: "owner", approvedBy: "owner", requiresSecondApprover: false, canApprove: true, expiresAt: "2020-01-01T12:00:00Z" }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe("saved lodging discovery", () => {
  it("reads an expired recorded outcome with sending unavailable", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => new Response(JSON.stringify(String(url).includes("type=workflows")
      ? { items: [{ changeSet, attemptId: "22222222-2222-4222-8222-222222222222" }], nextCursor: null }
      : { attempt: { id: "22222222-2222-4222-8222-222222222222", reviewId: changeSet.id, targetResourceName: "locations/fixture", status: "succeeded", idempotent: true, executionState: "unknown", confirmationState: "confirmed", createdAt: "2026-09-30T10:00:00Z", observedAt: "2026-09-30T10:01:00Z", errorCode: null } }), { headers: { "content-type": "application/json" } }))
    vi.stubGlobal("fetch", fetchMock)
    renderWithProviders(<LodgingWorkspaceProvider locationId="fixture"><SavedLodgingWork locationId="fixture" enabled disabled /></LodgingWorkspaceProvider>)
    await userEvent.click(await screen.findByRole("button", { name: "Open lodging outcome" }))
    expect(await screen.findByText("Independently confirmed")).toBeInTheDocument()
    expect(screen.getByText("Google acknowledgement unknown")).toBeInTheDocument()
    expect(screen.queryByText("2026-09-30T10:01:00Z")).not.toBeInTheDocument()
    expect(document.querySelector('time[datetime="2026-09-30T10:01:00Z"]')).toHaveTextContent(/30 Sep/)
    expect(screen.queryByRole("button", { name: "Send approved lodging changes" })).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true)
  })

  it("titles saved work for people and says an expired approval in local time", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ items: [{ changeSet: { ...changeSet, targetResourceName: "locations/stub-5a0c7a1e" }, attemptId: null }], nextCursor: null }), { headers: { "content-type": "application/json" } })))
    renderWithProviders(<LodgingWorkspaceProvider locationId="fixture"><SavedLodgingWork locationId="fixture" enabled disabled /></LodgingWorkspaceProvider>)
    const region = within(await screen.findByRole("region", { name: "Saved lodging work" }))
    expect(await region.findByText("Lodging details for Fixture Hotel")).toBeInTheDocument()
    expect(region.getByText("Google target: locations/stub-5a0c7a1e")).toHaveClass("text-ink-muted", "break-all")
    expect(region.getByText(/Approval expired/)).toBeInTheDocument()
    expect(region.queryByText(/2020-01-01T12:00/)).not.toBeInTheDocument()
    expect(document.querySelector('time[datetime="2020-01-01T12:00:00Z"]')).not.toBeNull()
  })
  it("does not fetch privileged saved work for a user without access", () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)
    renderWithProviders(<LodgingWorkspaceProvider locationId="fixture"><SavedLodgingWork locationId="fixture" enabled={false} disabled /></LodgingWorkspaceProvider>)
    expect(screen.queryByRole("region", { name: "Saved lodging work" })).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
