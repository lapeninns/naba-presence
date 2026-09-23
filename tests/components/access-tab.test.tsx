import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import {
  AccessTab,
  VerificationTab,
} from "@/components/locations/administration"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}
const available = (data: unknown) => ({ data, error: null })
const ADMIN = { administration: {
  voice: available({ hasVoiceOfMerchant: true }), verifications: available({ verifications: [] }),
  verificationOptions: available({ options: [{ verificationMethod: "PHONE_CALL" }] }), googleUpdated: available(null),
  locationAdmins: available({ admins: [
    { admin: "owner@camden.test", role: "PRIMARY_OWNER" },
    { name: "locations/camden/admins/2", admin: "manager@camden.test", role: "MANAGER" },
  ] }),
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

describe("AccessTab (read + non-destructive)", () => {
  it("gates a member without firing the 403 GET", async () => {
    const fetchMock = stub({ canEditCanonical: false, canPublish: false })
    renderWithProviders(<AccessTab locationId="loc-1" locationName="Camden Hotel" />)
    expect(await screen.findByText(/available to owners and admins/i)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/administration"))).toBe(false)
  })
  it("humanises admin roles", async () => {
    stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<AccessTab locationId="loc-1" locationName="Camden Hotel" />)
    expect(await screen.findByText("Primary owner")).toBeInTheDocument()
    expect(screen.queryByText("PRIMARY_OWNER")).not.toBeInTheDocument()
  })
  it("shows a distinguishable pending state per invitation button, not both at once", async () => {
    let resolvePatch: (() => void) | undefined
    const patchGate = new Promise<void>((resolve) => { resolvePatch = resolve })
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url.includes("/capabilities")) return jsonResponse({ capabilities: { canEditCanonical: true, canPublish: true } })
      if (url.includes("/administration") && (init as RequestInit | undefined)?.method === "PATCH") {
        await patchGate
        return jsonResponse({ id: "m", status: "succeeded", idempotent: false })
      }
      if (url.includes("/administration")) {
        return jsonResponse({
          administration: {
            ...ADMIN.administration,
            invitations: available({ invitations: [{ name: "locations/camden/admins/pending-1", role: "MANAGER" }] }),
          },
        })
      }
      return jsonResponse({ id: "m", status: "succeeded", idempotent: false })
    })
    vi.stubGlobal("fetch", fetchMock)

    renderWithProviders(<AccessTab locationId="loc-1" locationName="Camden Hotel" />)
    const acceptButton = await screen.findByRole("button", { name: "Accept" })
    const declineButton = screen.getByRole("button", { name: "Decline" })

    await userEvent.click(acceptButton)

    // Only the clicked (Accept) button flips to its pending label — Decline
    // stays showing its idle label, just disabled while the shared mutation
    // is in flight.
    expect(await screen.findByRole("button", { name: "Accepting…" })).toBeInTheDocument()
    expect(declineButton).toBeInTheDocument()
    expect(declineButton).toBeDisabled()
    expect(screen.queryByRole("button", { name: "Declining…" })).not.toBeInTheDocument()

    resolvePatch?.()
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled())
  })

  it("create-admin sends the create_admin operation + confirmation", async () => {
    const fetchMock = stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<AccessTab locationId="loc-1" locationName="Camden Hotel" />)
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

describe("AccessTab (danger zone)", () => {
  it("delete-location requires the typed name and sends the permanent-delete confirmation", async () => {
    const fetchMock = stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<AccessTab locationId="loc-1" locationName="Camden Hotel" />)
    await userEvent.click(await screen.findByRole("button", { name: /delete this location/i }))
    const confirm = screen.getByRole("button", { name: "Delete location" })
    expect(confirm).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/type the location's name/i), "Camden Hotel")
    expect(confirm).toBeEnabled()
    await userEvent.click(confirm)
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PATCH")
      const body = JSON.parse((patch![1] as RequestInit).body as string)
      expect(body).toEqual({ operation: "delete_location", confirmation: "delete_google_location_permanently", payload: {} })
    })
  })

  it("delete-location never wires to the app-side unlink route", async () => {
    const fetchMock = stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<AccessTab locationId="loc-1" locationName="Camden Hotel" />)
    await userEvent.click(await screen.findByRole("button", { name: /delete this location/i }))
    await userEvent.type(screen.getByLabelText(/type the location's name/i), "Camden Hotel")
    await userEvent.click(screen.getByRole("button", { name: "Delete location" }))
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PATCH")
      expect(String(patch?.[0])).toContain("/administration")
    })
    // The location directory query legitimately reads /api/location-links in
    // the background (unrelated to this action), but nothing about deleting
    // this location may ever issue the app-side soft-unlink DELETE against it.
    expect(
      fetchMock.mock.calls.some(
        ([u, init]) => String(u).includes("/api/location-links") && (init as RequestInit)?.method === "DELETE"
      )
    ).toBe(false)
  })

  it("shows the never-undoable unlink note pointing at Connections", async () => {
    stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<AccessTab locationId="loc-1" locationName="Camden Hotel" />)
    expect(
      await screen.findByText(/To stop managing a location without deleting it from Google, unlink it under/i)
    ).toBeInTheDocument()
    const link = screen.getByRole("link", { name: /connections/i })
    expect(link).toHaveAttribute("href", "/settings/connections")
  })

  it("remove-administrator requires the typed name and sends the remove-administrator confirmation", async () => {
    const fetchMock = stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<AccessTab locationId="loc-1" locationName="Camden Hotel" />)
    await userEvent.click(await screen.findByRole("button", { name: /remove manager@camden\.test/i }))
    const confirm = screen.getByRole("button", { name: "Remove administrator" })
    expect(confirm).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/type the location's name/i), "Camden Hotel")
    expect(confirm).toBeEnabled()
    await userEvent.click(confirm)
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PATCH")
      const body = JSON.parse((patch![1] as RequestInit).body as string)
      expect(body).toEqual({
        operation: "delete_admin",
        confirmation: "remove_google_administrator",
        payload: { name: "locations/camden/admins/2" },
      })
    })
  })

  it("never offers to remove the primary owner", async () => {
    stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<AccessTab locationId="loc-1" locationName="Camden Hotel" />)
    await screen.findByText("Primary owner")
    expect(screen.queryByRole("button", { name: /remove owner@camden\.test/i })).not.toBeInTheDocument()
  })

  it("transfer-location requires a destination account, shows the access-loss warning, then requires the typed name and sends the transfer confirmation", async () => {
    const fetchMock = stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<AccessTab locationId="loc-1" locationName="Camden Hotel" />)
    await userEvent.click(await screen.findByRole("button", { name: /transfer this location/i }))
    const continueButton = screen.getByRole("button", { name: /continue/i })
    expect(continueButton).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/destination google account/i), "accounts/999")
    expect(continueButton).toBeEnabled()
    await userEvent.click(continueButton)

    expect(screen.getByText(/may lose the ability to manage it/i)).toBeInTheDocument()
    const confirm = screen.getByRole("button", { name: "Transfer location" })
    expect(confirm).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/type the location's name/i), "Camden Hotel")
    expect(confirm).toBeEnabled()
    await userEvent.click(confirm)
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PATCH")
      const body = JSON.parse((patch![1] as RequestInit).body as string)
      expect(body).toEqual({
        operation: "transfer_location",
        confirmation: "transfer_google_location",
        payload: { destinationAccount: "accounts/999" },
      })
    })
  })

  it("renders the danger zone as a section <h2> under the area's h1, never a second page heading", async () => {
    stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<AccessTab locationId="loc-1" locationName="Camden Hotel" />)
    const heading = await screen.findByRole("heading", { name: /danger zone/i })
    expect(heading.tagName).toBe("H2")
    expect(screen.queryAllByRole("heading", { level: 1 })).toHaveLength(0)
  })
})

describe("VerificationTab", () => {
  it("answers whether Google trusts the listing, without the access controls", async () => {
    stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(
      <VerificationTab locationId="loc-1" locationName="Camden Hotel" />
    )
    expect(
      await screen.findByRole("heading", { name: "How Google sees this listing" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "Start a new verification" })
    ).toBeInTheDocument()
    // Who may edit the listing is a different question, asked on its own tab.
    expect(screen.queryByText("Primary owner")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /delete this location/i })
    ).not.toBeInTheDocument()
  })
})
