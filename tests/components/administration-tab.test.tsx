import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { AdministrationTab } from "@/components/locations/administration-tab"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}
const available = (data: unknown) => ({ data, error: null })
const ADMIN = { administration: {
  voice: available({ hasVoiceOfMerchant: true }), verifications: available({ verifications: [] }),
  verificationOptions: available({ options: [{ verificationMethod: "PHONE_CALL" }] }), googleUpdated: available(null),
  locationAdmins: available({ admins: [{ admin: "owner@camden.test", role: "PRIMARY_OWNER" }] }),
  accountAdmins: available({ admins: [] }), invitations: available({ invitations: [] }),
  accountName: "accounts/1", googleLocationName: "locations/camden", canManage: true, writesEnabled: true,
} }

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
function stub(caps: unknown) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input)
    if (url.includes("/capabilities")) return jsonResponse({ capabilities: caps })
    if (url.includes("/administration")) return jsonResponse(ADMIN)
    return jsonResponse({ id: "m", status: "succeeded", idempotent: false })
  })
  vi.stubGlobal("fetch", fetchMock); return fetchMock
}

describe("AdministrationTab (read + non-destructive)", () => {
  it("gates a member without firing the 403 GET", async () => {
    const fetchMock = stub({ canEditCanonical: false, canPublish: false })
    renderWithProviders(<AdministrationTab locationId="loc-1" locationName="Camden Hotel" />)
    expect(await screen.findByText(/available to owners and admins/i)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/administration"))).toBe(false)
  })
  it("humanises admin roles", async () => {
    stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<AdministrationTab locationId="loc-1" locationName="Camden Hotel" />)
    expect(await screen.findByText("Primary owner")).toBeInTheDocument()
    expect(screen.queryByText("PRIMARY_OWNER")).not.toBeInTheDocument()
  })
  it("create-admin sends the create_admin operation + confirmation", async () => {
    const fetchMock = stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<AdministrationTab locationId="loc-1" locationName="Camden Hotel" />)
    await userEvent.click(await screen.findByRole("button", { name: /add administrator/i }))
    await userEvent.type(screen.getByLabelText(/email/i), "new@camden.test")
    await userEvent.click(screen.getByRole("button", { name: /send invitation/i }))
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PATCH")
      const body = JSON.parse((patch![1] as RequestInit).body as string)
      expect(body.operation).toBe("create_admin")
      expect(body.confirmation).toBe("invite_google_administrator")
    })
  })
})
