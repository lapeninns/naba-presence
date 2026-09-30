import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useServiceReview } from "@/components/locations/profile/sections/use-service-review"
import { ServiceApprovalSheet } from "@/components/locations/profile/sections/service-approval-sheet"
import { renderWithProviders } from "../helpers/render"

const review = { id: "11111111-1111-4111-8111-111111111111", locationName: "Fixture Clinic", targetResourceName: "locations/fixture", payloadHash: "b".repeat(64), baselineHash: "a".repeat(64), payload: { serviceItems: [{ freeFormServiceItem: { category: "gcid:doctor", label: { displayName: "Consultation" } } }] }, baseline: { serviceItems: [] }, updateMask: ["serviceItems"], requestedBy: "owner", approvedBy: null, requiresSecondApprover: false, canApprove: true, expiresAt: "2027-01-01T12:00:00Z" }
const saved = { id: "22222222-2222-4222-8222-222222222222", reviewId: review.id, targetResourceName: "locations/fixture", status: "succeeded", idempotent: true, executionState: "unknown", confirmationState: "confirmed", createdAt: "2026-09-30T10:00:00Z", observedAt: "2026-09-30T10:01:00Z", errorCode: null }
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })
function Harness({ approved = false }: { approved?: boolean }) {
  const workflow = useServiceReview("fixture", () => {})
  return <><button onClick={() => workflow.restore({ ...review, approvedBy: approved ? "owner" : null })}>Open services</button>
    <ServiceApprovalSheet workflow={workflow} rows={[{ field: "Service 1", before: "No service", after: "Consultation" }]} disabled={false} /></>
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe("explicit general service approval and recovery", () => {
  it("approves without sending and requires fresh consent for the separate write", async () => {
    let sent = false
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.method === "POST") return response({ changeSet: { ...review, approvedBy: "owner" } })
      if (init?.method === "PATCH") { sent = true; return response({ ...saved, idempotent: false }) }
      return sent ? response({ attempt: saved }) : response({ error: "service_attempt_not_found", message: "No attempt." }, 404)
    })
    vi.stubGlobal("fetch", fetchMock)
    renderWithProviders(<Harness />)
    await userEvent.click(screen.getByRole("button", { name: "Open services" }))
    const dialog = within(screen.getByRole("dialog", { name: "Review service changes" }))
    await waitFor(() => expect(dialog.getByRole("button", { name: "Approve service changes" })).toBeEnabled())
    await userEvent.click(dialog.getByRole("button", { name: "Approve service changes" }))
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0)
    const send = await dialog.findByRole("button", { name: "Send approved service changes" })
    expect(send).toBeDisabled()
    await userEvent.click(dialog.getByRole("checkbox", { name: "Send these exact approved service changes to Google." }))
    await userEvent.click(send)
    expect(await dialog.findByText("Independently confirmed")).toBeInTheDocument()
    expect(dialog.getByText("Google acknowledgement unknown")).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1)
  })
  it("keeps a lost send unsendable even when the first saved read is unavailable, then recovers without replay", async () => {
    let sent = false, available = false
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.method === "PATCH") { sent = true; throw new Error("Lost response") }
      return sent && available ? response({ attempt: saved }) : response({ error: "service_attempt_not_found", message: "No attempt loaded." }, 404)
    })
    vi.stubGlobal("fetch", fetchMock)
    renderWithProviders(<Harness approved />)
    await userEvent.click(screen.getByRole("button", { name: "Open services" }))
    const dialog = within(screen.getByRole("dialog", { name: "Review service changes" }))
    await waitFor(() => expect(dialog.getByRole("checkbox")).toBeEnabled())
    await userEvent.click(dialog.getByRole("checkbox"))
    await userEvent.click(dialog.getByRole("button", { name: "Send approved service changes" }))
    expect(await dialog.findByText(/The send response is unavailable/)).toBeInTheDocument()
    await userEvent.click(dialog.getByRole("button", { name: "Read saved service outcome" }))
    expect(await dialog.findByRole("alert")).toHaveTextContent("No attempt loaded.")
    expect(dialog.queryByRole("button", { name: "Send approved service changes" })).not.toBeInTheDocument()
    available = true
    await userEvent.click(dialog.getByRole("button", { name: "Read saved service outcome" }))
    expect(await dialog.findByText("Independently confirmed")).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1)
  })
})
