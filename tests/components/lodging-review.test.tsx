import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { LodgingReview } from "@/components/locations/profile/sections/lodging-review"
import { renderWithProviders } from "../helpers/render"

const review = { id: "11111111-1111-4111-8111-111111111111", locationName: "Fixture Hotel", targetResourceName: "locations/fixture", payloadHash: "b".repeat(64), baselineHash: "a".repeat(64), payload: { pets: { petsAllowed: true } }, baseline: { pets: { petsAllowed: false } }, updateMask: ["pets.petsAllowed"], requestedBy: "owner", approvedBy: null, requiresSecondApprover: false, canApprove: true, expiresAt: "2027-01-01T12:00:00Z" }
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe("explicit lodging approval and consent", () => {
  it("approves the exact saved review without sending and asks for consent before the separate provider action", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => init?.method === "GET"
      ? new Response(JSON.stringify({ error: "lodging_attempt_not_found", message: "No saved attempt." }), { status: 404 })
      : init?.method === "POST" ? response({ changeSet: { ...review, approvedBy: "owner" } })
      : response({ id: "22222222-2222-4222-8222-222222222222", status: "succeeded", idempotent: false, executionState: "accepted", confirmationState: "confirmed" }))
    vi.stubGlobal("fetch", fetchMock)
    renderWithProviders(<LodgingReview locationId="fixture" payload={review.payload} updateMask={review.updateMask} googleHash={review.baselineHash} saved={[review]} disabled={false} />)
    await userEvent.click(screen.getByRole("button", { name: "Review saved lodging change" }))
    const dialog = within(screen.getByRole("dialog", { name: "Review changes" }))
    await waitFor(() => expect(dialog.getByRole("button", { name: "Approve lodging changes" })).toBeEnabled())
    await userEvent.click(dialog.getByRole("button", { name: "Approve lodging changes" }))
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0)
    const send = await dialog.findByRole("button", { name: "Send approved lodging changes" })
    expect(send).toBeDisabled()
    await userEvent.click(dialog.getByRole("checkbox", { name: "Send these exact approved lodging changes to Google." }))
    await userEvent.click(send)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1)
    expect(await screen.findByText("Lodging details confirmed by Google")).toBeInTheDocument()
  })

  it("keeps an unapproved second-manager review unsendable", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: "lodging_attempt_not_found", message: "No saved attempt." }), { status: 404 }))
    vi.stubGlobal("fetch", fetchMock)
    renderWithProviders(<LodgingReview locationId="fixture" payload={review.payload} updateMask={review.updateMask} googleHash={review.baselineHash} saved={[{ ...review, canApprove: false, requiresSecondApprover: true }]} disabled={false} />)
    await userEvent.click(screen.getByRole("button", { name: "Review saved lodging change" }))
    const dialog = within(screen.getByRole("dialog", { name: "Review changes" }))
    expect(dialog.getByRole("button", { name: "Approve lodging changes" })).toBeDisabled()
    expect(dialog.queryByRole("button", { name: "Send approved lodging changes" })).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true)
  })

  it("recovers a lost send response through an exact read without replay and keeps unknown acknowledgement distinct", async () => {
    let applied = false
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.method === "PATCH") { applied = true; throw new Error("Lost response") }
      if (!applied) return new Response(JSON.stringify({ error: "lodging_attempt_not_found", message: "No saved attempt." }), { status: 404 })
      return response({ attempt: { id: "22222222-2222-4222-8222-222222222222", reviewId: review.id, targetResourceName: "locations/fixture", status: "succeeded", idempotent: true, executionState: "unknown", confirmationState: "confirmed", createdAt: "2026-09-30T10:00:00Z", observedAt: "2026-09-30T10:01:00Z", errorCode: null } })
    })
    const lock = vi.fn<(locked: boolean) => void>()
    vi.stubGlobal("fetch", fetchMock)
    renderWithProviders(<LodgingReview locationId="fixture" payload={review.payload} updateMask={review.updateMask} googleHash={review.baselineHash} saved={[{ ...review, approvedBy: "owner" }]} disabled={false} onLock={lock} />)
    await userEvent.click(screen.getByRole("button", { name: "Review approved lodging change" }))
    const dialog = within(screen.getByRole("dialog", { name: "Review changes" }))
    const consent = dialog.getByRole("checkbox", { name: "Send these exact approved lodging changes to Google." })
    await waitFor(() => expect(consent).toBeEnabled())
    await userEvent.click(consent)
    await userEvent.click(dialog.getByRole("button", { name: "Send approved lodging changes" }))
    expect(await dialog.findByText(/The send response is unavailable/)).toBeInTheDocument()
    expect(lock).toHaveBeenLastCalledWith(true)
    expect(dialog.queryByRole("button", { name: "Send approved lodging changes" })).not.toBeInTheDocument()
    await userEvent.click(dialog.getByRole("button", { name: "Read saved lodging outcome" }))
    expect(await dialog.findByText("Independently confirmed")).toBeInTheDocument()
    expect(dialog.getByText("Google acknowledgement unknown")).toBeInTheDocument()
    expect(dialog.queryByText("2026-09-30T10:01:00Z")).not.toBeInTheDocument()
    expect(document.querySelector('time[datetime="2026-09-30T10:01:00Z"]')).toHaveTextContent(/30 Sept/)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1)
    await waitFor(() => expect(lock).toHaveBeenLastCalledWith(false))
  })
})
