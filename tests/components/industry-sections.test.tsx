import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { IndustrySections } from "@/components/locations/profile/sections/industry-sections"
import { Toaster } from "@/components/ui/toast"

/** The checked answer of the Yes / No / Not recorded choice named `name`. */
function answerIn(container: HTMLElement, name: string) {
  return within(within(container).getByRole("radiogroup", { name })).getByRole("radio", { checked: true })
}

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
    expect(answerIn(screen.getByRole("region", { name: "Lodging details" }), "Pets allowed")).toHaveAccessibleName("Yes")
    await userEvent.clear(screen.getByRole("searchbox"))
    await userEvent.paste("Free wifi")
    expect(answerIn(screen.getByRole("region", { name: "Lodging details" }), "Free Wi-Fi")).toHaveAccessibleName("Yes")
  })

  it("keeps unsaved lodging edits when a refetch brings a newer version, and offers it", async () => {
    let current: unknown = INDUSTRY
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes("/capabilities")) return jsonResponse({ capabilities: { canEditCanonical: true, canPublish: true } })
      if (url.includes("/industry")) return jsonResponse(current)
      return jsonResponse({ id: "m", status: "succeeded", idempotent: false })
    }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><Toaster><IndustrySections locationId="loc-1" /></Toaster></QueryClientProvider>)
    expect(await screen.findByRole("region", { name: "Suggested lodging changes" })).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Apply suggested pets allowed to draft" }))
    const details = screen.getByRole("region", { name: "Lodging details" })
    await userEvent.click(screen.getByRole("searchbox"))
    await userEvent.paste("Pets allowed")
    expect(answerIn(details, "Pets allowed")).toHaveAccessibleName("Yes")

    // Someone else changed the lodging in Google: a new hash and new content.
    current = { industry: { ...INDUSTRY.industry, lodgingHash: "b".repeat(64), lodging: available({
      policies: { checkinTime: { hours: 16, minutes: 0 } },
      pets: { petsAllowed: false },
    }) } }
    await act(() => client.invalidateQueries())

    expect(await screen.findByText("Someone else saved these lodging details while you were editing")).toBeInTheDocument()
    expect(answerIn(screen.getByRole("region", { name: "Lodging details" }), "Pets allowed")).toHaveAccessibleName("Yes")

    // Loading theirs replaces the edits with the newer version.
    await userEvent.click(screen.getByRole("button", { name: "Load theirs" }))
    expect(answerIn(screen.getByRole("region", { name: "Lodging details" }), "Pets allowed")).toHaveAccessibleName("No")
  })

  it("follows a refetch silently while the lodging draft is clean", async () => {
    let current: unknown = INDUSTRY
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes("/capabilities")) return jsonResponse({ capabilities: { canEditCanonical: true, canPublish: true } })
      if (url.includes("/industry")) return jsonResponse(current)
      return jsonResponse({ id: "m", status: "succeeded", idempotent: false })
    }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><Toaster><IndustrySections locationId="loc-1" /></Toaster></QueryClientProvider>)
    expect(await screen.findByRole("region", { name: "Suggested lodging changes" })).toBeInTheDocument()
    current = { industry: { ...INDUSTRY.industry, lodgingHash: "b".repeat(64), lodging: available({ pets: { petsAllowed: true } }) } }
    await act(() => client.invalidateQueries())
    await userEvent.click(screen.getByRole("searchbox"))
    await userEvent.paste("Pets allowed")
    await waitFor(() => expect(answerIn(screen.getByRole("region", { name: "Lodging details" }), "Pets allowed")).toHaveAccessibleName("Yes"))
    expect(screen.queryByText(/Someone else saved/)).not.toBeInTheDocument()
  })

  it("follows its own confirmed publish silently when the readback moves Google's metadata", async () => {
    const lodging = { metadata: { updateTime: "2026-10-01T00:00:00Z" }, policies: { checkinTime: { hours: 15, minutes: 0 } }, pets: { petsAllowed: false } }
    let current: unknown = { industry: { ...INDUSTRY.industry, lodging: available(lodging) } }
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes("/capabilities")) return jsonResponse({ capabilities: { canEditCanonical: true, canPublish: true } })
      if (url.includes("/industry")) return jsonResponse(current)
      return jsonResponse({ id: "m", status: "succeeded", idempotent: false })
    }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><Toaster><IndustrySections locationId="loc-1" /></Toaster></QueryClientProvider>)
    expect(await screen.findByRole("region", { name: "Suggested lodging changes" })).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Apply suggested pets allowed to draft" }))
    await userEvent.click(screen.getByRole("searchbox"))
    await userEvent.paste("Pets allowed")
    expect(answerIn(screen.getByRole("region", { name: "Lodging details" }), "Pets allowed")).toHaveAccessibleName("Yes")

    // Google confirmed the publish: the readback carries a new hash and the
    // backend's new updateTime, with exactly the values this draft sent.
    current = { industry: { ...INDUSTRY.industry, lodgingHash: "b".repeat(64), lodging: available({
      metadata: { updateTime: "2026-10-09T12:00:00Z" },
      pets: { petsAllowed: true },
      policies: { checkinTime: { hours: 15, minutes: 0 } },
    }) } }
    await act(() => client.invalidateQueries())

    await waitFor(() => expect(answerIn(screen.getByRole("region", { name: "Lodging details" }), "Pets allowed")).toHaveAccessibleName("Yes"))
    expect(screen.queryByText(/Someone else saved/)).not.toBeInTheDocument()
  })

  it("omits retired controls even when an old response contains their data", async () => {
    const fetchMock = stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<IndustrySections locationId="loc-1" />)
    expect(await screen.findByRole("region", { name: "Suggested lodging changes" })).toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "Calls" })).not.toBeInTheDocument()
    expect(screen.queryByRole("radiogroup", { name: "Calls" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /save calls/i })).not.toBeInTheDocument()
    expect(screen.queryByText("Provider attributes", { exact: true })).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false)
  })

  it("does not report publication success when Google confirmation is unresolved", async () => {
    const changeSet = { id: "11111111-1111-4111-8111-111111111111", locationName: "Hotel", targetResourceName: "locations/hotel", payloadHash: "b".repeat(64), baselineHash: "a".repeat(64), payload: { pets: { petsAllowed: true } }, baseline: { pets: { petsAllowed: false } }, updateMask: ["pets"], requestedBy: "owner", approvedBy: null, requiresSecondApprover: false, canApprove: true, expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString() }
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).includes("/capabilities")) return jsonResponse({ capabilities: { canEditCanonical: true, canPublish: true } })
      if (init?.method === "PUT") return jsonResponse({ changeSet })
      if (init?.method === "POST") return jsonResponse({ changeSet: { ...changeSet, approvedBy: "owner" } })
      if (init?.method === "PATCH") return jsonResponse({ id: "m", status: "ambiguous", idempotent: false, executionState: "accepted", confirmationState: "unresolved" })
      return jsonResponse(INDUSTRY)
    })
    vi.stubGlobal("fetch", fetchMock)
    renderWithProviders(<IndustrySections locationId="loc-1" />)
    await userEvent.type(await screen.findByRole("searchbox"), "Pets allowed")
    await userEvent.click(within(within(screen.getByRole("region", { name: "Lodging details" })).getByRole("radiogroup", { name: "Pets allowed" })).getByRole("radio", { name: "Yes" }))
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
    // Only the supported lodging operation is ever sent.
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")
    const body = JSON.parse(String(patch?.[1]?.body))
    expect(body.operation).toBe("update_lodging")
    expect(body.updateMask).toEqual(["pets"])
    expect(body.confirmation).toBe("publish_industry_data_to_google")
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
    expect(await screen.findByRole("region", { name: "Lodging details" })).toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "Calls" })).not.toBeInTheDocument()
    expect(screen.queryByRole("radiogroup", { name: "Calls" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /save calls/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /save lodging/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/business calls/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/provider attributes/i)).not.toBeInTheDocument()
  })
})
