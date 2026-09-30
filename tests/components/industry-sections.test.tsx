import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { IndustrySections } from "@/components/locations/profile/sections/industry-sections"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}
const available = (data: unknown) => ({ data, error: null })
const INDUSTRY = { industry: {
  lodgingHash: "a".repeat(64),
  lodging: available({
    policies: { checkinTime: { hours: 15, minutes: 0 } },
    pets: { petsAllowed: false },
  }),
  lodgingUpdated: available({
    diffMask: "pets,connectivity",
    lodging: { pets: { petsAllowed: true }, connectivity: { freeWifi: true } },
  }),
  calls: available({ callsState: "ENABLED" }), callInsights: available({}),
  healthcareServices: { data: null, error: "Google 500 boom" }, providerAttributes: available({}), insuranceNetworks: available({}),
  canManage: true, writesEnabled: true,
} }

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function stub(caps: unknown) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input)
    if (url.includes("/capabilities")) return jsonResponse({ capabilities: caps })
    if (url.includes("/industry")) return jsonResponse(INDUSTRY)
    return jsonResponse({ id: "m", status: "succeeded", idempotent: false })
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

describe("IndustrySections", () => {
  it("shows a member nothing at all, and never fires the 403 GET", async () => {
    const fetchMock = stub({ canEditCanonical: false, canPublish: false })
    const { container } = renderWithProviders(<IndustrySections locationId="loc-1" />)
    // A member has no business seeing "available to owners and admins" halfway
    // down a profile they can otherwise read: the group simply isn't theirs.
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/capabilities"))).toBe(true)
    )
    expect(container).toBeEmptyDOMElement()
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/industry"))).toBe(false)
  })

  it("does not render a second healthcare services panel from a legacy response", async () => {
    stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<IndustrySections locationId="loc-1" />)
    expect(await screen.findByRole("region", { name: "Lodging details" })).toBeInTheDocument()
    expect(screen.queryByText(/couldn't load healthcare/i)).not.toBeInTheDocument()
    expect(screen.queryByText("Healthcare services", { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument()
  })

  it("applies Google suggested lodging values into the form", async () => {
    stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<IndustrySections locationId="loc-1" />)
    expect(await screen.findByRole("region", { name: "Suggested lodging changes" })).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Apply suggested pets allowed to draft" }))
    await userEvent.click(screen.getByRole("button", { name: "Apply suggested free wi-fi to draft" }))
    await userEvent.click(screen.getByRole("searchbox"))
    await userEvent.paste("Pets allowed")
    expect(within(screen.getByRole("region", { name: "Lodging details" })).getByRole("combobox", { name: "Pets allowed" })).toHaveTextContent("Yes")
    await userEvent.clear(screen.getByRole("searchbox"))
    await userEvent.paste("Free wifi")
    expect(within(screen.getByRole("region", { name: "Lodging details" })).getByRole("combobox", { name: "Free Wi-Fi" })).toHaveTextContent("Yes")
  })

  it("omits retired controls even when an old response contains their data", async () => {
    const fetchMock = stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<IndustrySections locationId="loc-1" />)
    expect(await screen.findByRole("region", { name: "Suggested lodging changes" })).toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "Calls" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /save calls/i })).not.toBeInTheDocument()
    expect(screen.queryByText("Provider attributes", { exact: true })).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false)
  })

  it("does not report publication success when Google confirmation is unresolved", async () => {
    const changeSet = { id: "11111111-1111-4111-8111-111111111111", locationName: "Hotel", targetResourceName: "locations/hotel", payloadHash: "b".repeat(64), baselineHash: "a".repeat(64), payload: { pets: { petsAllowed: true } }, baseline: { pets: { petsAllowed: false } }, updateMask: ["pets"], requestedBy: "owner", approvedBy: null, requiresSecondApprover: false, canApprove: true, expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString() }
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).includes("/capabilities")) return jsonResponse({ capabilities: { canEditCanonical: true, canPublish: true } })
      if (init?.method === "PUT") return jsonResponse({ changeSet })
      if (init?.method === "POST") return jsonResponse({ changeSet: { ...changeSet, approvedBy: "owner" } })
      if (init?.method === "PATCH") return jsonResponse({ id: "m", status: "ambiguous", idempotent: false, executionState: "accepted", confirmationState: "unresolved" })
      return jsonResponse(INDUSTRY)
    }))
    renderWithProviders(<IndustrySections locationId="loc-1" />)
    await userEvent.type(await screen.findByRole("searchbox"), "Pets allowed")
    await userEvent.click(within(screen.getByRole("region", { name: "Lodging details" })).getByRole("combobox", { name: "Pets allowed" }))
    await userEvent.click(await screen.findByRole("option", { name: "Yes" }))
    await userEvent.click(screen.getByRole("button", { name: "Review lodging changes" }))
    expect(await screen.findByRole("dialog", { name: "Review changes" })).toBeInTheDocument()
    const dialog = within(screen.getByRole("dialog", { name: "Review changes" }))
    expect(dialog.getByText("No", { exact: true })).toBeInTheDocument()
    expect(dialog.getByText("Yes", { exact: true })).toBeInTheDocument()
    await userEvent.click(dialog.getByRole("button", { name: "Approve lodging changes" }))
    await userEvent.click(await dialog.findByRole("checkbox", { name: "Send these exact approved lodging changes to Google." }))
    await userEvent.click(dialog.getByRole("button", { name: "Send approved lodging changes" }))
    expect(await screen.findByText(/Google confirmation is unresolved/)).toBeInTheDocument()
    expect(screen.queryByText("Lodging details confirmed by Google")).not.toBeInTheDocument()
  })
})
