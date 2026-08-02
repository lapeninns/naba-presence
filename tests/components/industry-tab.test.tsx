import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { IndustryTab } from "@/components/locations/industry-tab"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}
const available = (data: unknown) => ({ data, error: null })
const INDUSTRY = { industry: {
  lodging: available({ policies: { checkinTime: "15:00" } }), lodgingUpdated: available({}),
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

describe("IndustryTab", () => {
  it("gates a member without firing the 403 GET", async () => {
    const fetchMock = stub({ canEditCanonical: false, canPublish: false })
    renderWithProviders(<IndustryTab locationId="loc-1" />)
    expect(await screen.findByText(/available to owners and admins/i)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/industry"))).toBe(false)
  })

  it("shows the honest section error, never the raw Google message", async () => {
    stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<IndustryTab locationId="loc-1" />)
    expect(await screen.findByText(/couldn't load healthcare/i)).toBeInTheDocument()
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument()
  })

  it("business-calls publish sets callsState, masks only callsState, and sends the industry confirmation", async () => {
    const fetchMock = stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<IndustryTab locationId="loc-1" />)
    // The calls control is a base-ui Select (NOT a native <select>), so drive it
    // for real: open the trigger, then click the humanised "Off" option (value
    // DISABLED). No `?.`/`.catch()` — the interaction must actually change state.
    await userEvent.click(await screen.findByRole("combobox", { name: "Calls" }))
    await userEvent.click(await screen.findByRole("option", { name: "Off" }))
    await userEvent.click(screen.getByRole("button", { name: /save calls/i }))
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PATCH")
      const body = JSON.parse((patch![1] as RequestInit).body as string)
      expect(body.operation).toBe("update_business_calls")
      expect(body.payload.callsState).toBe("DISABLED") // the interaction actually changed the value
      expect(body.updateMask).toEqual(["callsState"])
      expect(body.confirmation).toBe("publish_industry_data_to_google")
    })
  })
})
