import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { usePlaceActionReview } from "@/components/locations/place-actions/use-place-action-review"
import { PlaceActionApprovalSheet } from "@/components/locations/place-actions/place-action-approval-sheet"
import { SavedPlaceActionWork, placeActionWorkLabel } from "@/components/locations/place-actions/saved-place-action-work"
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
  it("never offers a lost-response recovery it cannot act on: in flight is pending, settled is enabled", async () => {
    let failSend: (error: Error) => void = () => {}, finishRead: (value: Response) => void = () => {}, sent = false
    const fetchMock = vi.fn<typeof fetch>((_url, init) => {
      if (init?.method === "POST") { sent = true; return new Promise((_, reject) => { failSend = reject }) }
      if (sent) return new Promise((resolve) => { finishRead = resolve })
      return Promise.resolve(response({ error: "place_action_attempt_not_found", message: "No attempt." }, 404))
    })
    vi.stubGlobal("fetch", fetchMock); renderWithProviders(<Harness approved />)
    await userEvent.click(screen.getByRole("button", { name: "Open action review" }))
    const dialog = within(screen.getByRole("dialog", { name: "Review action link change" }))
    await waitFor(() => expect(dialog.getByRole("checkbox")).toBeEnabled())
    await userEvent.click(dialog.getByRole("checkbox")); await userEvent.click(dialog.getByRole("button", { name: "Send approved action link change" }))
    // In flight: the sheet says it is sending, not that the response is lost.
    expect(await dialog.findByText(/Sending to Google/)).toBeInTheDocument()
    expect(dialog.queryByText(/The send response is unavailable/)).not.toBeInTheDocument()
    expect(dialog.getByRole("button", { name: "Sending…" })).toHaveAttribute("aria-busy", "true")
    failSend(new Error("Lost response"))
    const lost = await screen.findByText(/The send response is unavailable/)
    const outcome = within(screen.getByRole("dialog", { name: "Saved action link outcome" }))
    expect(lost).toBeInTheDocument()
    expect(outcome.getByRole("button", { name: "Read saved action link outcome" })).toBeEnabled()
    expect(outcome.getByRole("button", { name: "Keep editing" })).toBeEnabled()
    await userEvent.click(outcome.getByRole("button", { name: "Read saved action link outcome" }))
    expect(await outcome.findByRole("button", { name: "Reading saved outcome…" })).toHaveAttribute("aria-busy", "true")
    expect(outcome.queryByText(/The send response is unavailable/)).not.toBeInTheDocument()
    finishRead(response({ attempt: saved }))
    expect(await outcome.findByText("Independently confirmed")).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1)
  })
})

describe("saved action link work", () => {
  const removal: GbpChangeSet = { ...review, approvedBy: "owner", targetResourceName: "locations/stub-5a0c7a1e-0000-4000-8000-000000000000", expiresAt: "2020-01-01T21:04:00Z",
    payload: { ...review.payload, request: { operation: "delete", name: "locations/fixture/placeActionLinks/2" } },
    baseline: { ...review.baseline, links: [{ name: "locations/fixture/placeActionLinks/2", uri: "https://shop.example.test/old", placeActionType: "SHOP_ONLINE", isPreferred: false, providerType: "MERCHANT", isEditable: true, createTime: null, updateTime: null }] } }

  it("labels saved work in the customer's words", () => {
    expect(placeActionWorkLabel(review)).toEqual({ title: "Add Shop online link", uri: "https://shop.example.test/products" })
    expect(placeActionWorkLabel(removal)).toEqual({ title: "Remove Shop online link", uri: "https://shop.example.test/old" })
  })

  it("titles cards by link, keeps the resource secondary, and says an approval expired in local time", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (url) => String(url).includes("capabilities")
      ? response({ capabilities: { canEditCanonical: true, canPublish: false } })
      : response({ items: [{ changeSet: removal, attemptId: null }], nextCursor: null })))
    function Saved() { return <SavedPlaceActionWork locationId="fixture" workflow={usePlaceActionReview("fixture")} /> }
    renderWithProviders(<Saved />)
    const region = within(await screen.findByRole("region", { name: "Saved action link work" }))
    expect(await region.findByText("Remove Shop online link")).toBeInTheDocument()
    expect(region.getByText("https://shop.example.test/old")).toBeInTheDocument()
    expect(region.getByText(/^Google target: locations\/stub-/)).toHaveClass("text-ink-muted", "break-all")
    expect(region.getByText(/Approval expired/)).toBeInTheDocument()
    expect(region.queryByText(/2020-01-01T21:04/)).not.toBeInTheDocument()
    expect(document.querySelector('time[datetime="2020-01-01T21:04:00Z"]')).not.toBeNull()
  })
})
