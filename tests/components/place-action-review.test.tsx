import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { usePlaceActionReview } from "@/components/locations/place-actions/use-place-action-review"
import { PlaceActionApprovalSheet } from "@/components/locations/place-actions/place-action-approval-sheet"
import { renderWithProviders } from "../helpers/render"
import type { GbpChangeSet } from "@/lib/contracts/gbp-change-set"

const request = { operation: "create", payload: { uri: "https://shop.example.test/products", placeActionType: "SHOP_ONLINE", isPreferred: false } }
const review: GbpChangeSet = { id: "11111111-1111-4111-8111-111111111111", locationName: "Fixture Shop", targetResourceName: "locations/fixture", payloadHash: "b".repeat(64), baselineHash: "a".repeat(64),
  payload: { request, connectionId: "33333333-3333-4333-8333-333333333333", credentialGeneration: 1, observedAt: "2026-09-30T10:00:00Z" },
  baseline: { collection: "locations/fixture/placeActionLinks", supportedTypes: ["SHOP_ONLINE"], unsupportedTypes: [], links: [] },
  updateMask: [], requestedBy: "owner", approvedBy: null, requiresSecondApprover: false, canApprove: true, expiresAt: "2027-01-01T12:00:00Z" }
const saved = { id: "22222222-2222-4222-8222-222222222222", reviewId: review.id, locationId: "44444444-4444-4444-8444-444444444444", target: "locations/fixture", payloadHash: review.payloadHash, request,
  idempotent: true, executionState: "unknown", confirmationState: "confirmed", observedAt: "2026-09-30T10:01:00Z", errorCode: null }
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })
function Harness({ approved = false }: { approved?: boolean }) {
  const workflow = usePlaceActionReview("fixture")
  return <><button onClick={() => workflow.restore({ ...review, approvedBy: approved ? "owner" : null })}>Open action review</button>
    <PlaceActionApprovalSheet workflow={workflow} disabled={false} /></>
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe("explicit Place Actions approval and recovery", () => {
  it("approves without sending, requires consent, and preserves unknown acknowledgement alongside confirmation", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      if (init?.method === "POST" && String(url).endsWith("/execute")) return response({ attempt: saved })
      if (init?.method === "POST") return response({ review: { changeSet: { ...review, approvedBy: "owner" }, request, target: "locations/fixture", observedAt: "2026-09-30T10:00:00Z" } })
      return response({ error: "place_action_attempt_not_found", message: "No attempt." }, 404)
    })
    vi.stubGlobal("fetch", fetchMock); renderWithProviders(<Harness />)
    await userEvent.click(screen.getByRole("button", { name: "Open action review" }))
    const dialog = within(screen.getByRole("dialog", { name: "Review action link change" }))
    await waitFor(() => expect(dialog.getByRole("button", { name: "Approve action link change" })).toBeEnabled())
    await userEvent.click(dialog.getByRole("button", { name: "Approve action link change" }))
    expect(fetchMock.mock.calls.filter(([url, init]) => init?.method === "POST" && String(url).endsWith("/execute"))).toHaveLength(0)
    const send = await dialog.findByRole("button", { name: "Send approved action link change" })
    expect(send).toBeDisabled()
    await userEvent.click(dialog.getByRole("checkbox", { name: "Send this exact approved action link change to Google." }))
    await userEvent.click(send)
    expect(await dialog.findByText("Independently confirmed")).toBeInTheDocument()
    expect(dialog.getByText("Google acknowledgement unknown")).toBeInTheDocument()
    expect(dialog.queryByText("2026-09-30T10:01:00Z")).not.toBeInTheDocument()
    expect(document.querySelector('time[datetime="2026-09-30T10:01:00Z"]')).toHaveTextContent(/30 Sept/)
    expect(fetchMock.mock.calls.filter(([url, init]) => init?.method === "POST" && String(url).endsWith("/execute"))).toHaveLength(1)
  })
  it("keeps a lost send unsendable even when a saved read returns 404, then recovers without replay", async () => {
    let sent = false, available = false
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.method === "POST") { sent = true; throw new Error("Lost response") }
      return sent && available ? response({ attempt: saved }) : response({ error: "place_action_attempt_not_found", message: "No attempt loaded." }, 404)
    })
    vi.stubGlobal("fetch", fetchMock); renderWithProviders(<Harness approved />)
    await userEvent.click(screen.getByRole("button", { name: "Open action review" }))
    const dialog = within(screen.getByRole("dialog", { name: "Review action link change" }))
    await waitFor(() => expect(dialog.getByRole("checkbox")).toBeEnabled())
    await userEvent.click(dialog.getByRole("checkbox")); await userEvent.click(dialog.getByRole("button", { name: "Send approved action link change" }))
    expect(await dialog.findByText(/The send response is unavailable/)).toBeInTheDocument()
    await userEvent.click(dialog.getByRole("button", { name: "Read saved action link outcome" }))
    expect(await dialog.findByRole("alert")).toHaveTextContent("No attempt loaded.")
    expect(dialog.queryByRole("button", { name: "Send approved action link change" })).not.toBeInTheDocument()
    available = true
    await userEvent.click(dialog.getByRole("button", { name: "Read saved action link outcome" }))
    expect(await dialog.findByText("Independently confirmed")).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1)
  })
})
