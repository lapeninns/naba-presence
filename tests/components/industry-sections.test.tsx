import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { IndustrySections } from "@/components/locations/profile/sections/industry-sections"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}
const available = (data: unknown) => ({ data, error: null })
const INDUSTRY = { industry: {
  lodging: available({
    policies: { checkinTime: { hours: 15, minutes: 0 } },
    pets: { petsAllowed: false },
  }),
  lodgingUpdated: available({
    diffMask: "pets,connectivity",
    pets: { petsAllowed: true },
    connectivity: { freeWifi: true },
  }),
  healthcareServices: { data: null, error: "Google 500 boom" },
  canManage: true, writesEnabled: true,
} }

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function stub(caps: unknown, industry: unknown = INDUSTRY) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input)
    if (url.includes("/capabilities")) return jsonResponse({ capabilities: caps })
    if (url.includes("/industry")) return jsonResponse(industry)
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

  it("shows the honest section error, never the raw Google message", async () => {
    stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<IndustrySections locationId="loc-1" />)
    expect(await screen.findByText(/couldn't load healthcare/i)).toBeInTheDocument()
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument()
  })

  it("applies Google suggested lodging values into the form", async () => {
    stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<IndustrySections locationId="loc-1" />)
    expect(await screen.findByText(/google suggests changes/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: /apply suggested values/i }))
    expect(screen.getByLabelText("Pets allowed")).toBeChecked()
    expect(screen.getByLabelText("Free Wi‑Fi")).toBeChecked()
  })

  it("offers no Business Calls or provider-attribute controls, even for a response that still carries them", async () => {
    // A server from before the retired APIs were dropped still sent these
    // sections; the contract strips them and the editor never renders them.
    stub({ canEditCanonical: true, canPublish: true }, { industry: {
      ...INDUSTRY.industry,
      calls: available({ callsState: "ENABLED" }), callInsights: available({}),
      providerAttributes: available({ attributes: [] }), insuranceNetworks: available({}),
    } })
    renderWithProviders(<IndustrySections locationId="loc-1" />)
    expect(await screen.findByRole("button", { name: /save lodging/i })).toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "Calls" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /save calls/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/business calls/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/provider attributes/i)).not.toBeInTheDocument()
  })

  it("lodging publish sends only supported operations", async () => {
    const fetchMock = stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<IndustrySections locationId="loc-1" />)
    await userEvent.click(await screen.findByLabelText("Pets allowed"))
    await userEvent.click(screen.getByRole("button", { name: /save lodging/i }))
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PATCH")
      const body = JSON.parse((patch![1] as RequestInit).body as string)
      expect(body.operation).toBe("update_lodging")
      expect(body.updateMask).toEqual(["pets"])
      expect(body.confirmation).toBe("publish_industry_data_to_google")
    })
  })
})
