import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const push = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/clients/c1/settings",
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { ClientSettings } from "@/components/clients/client-settings"
import { Toaster } from "@/components/ui/toast"
import type { ClientSummary } from "@/lib/contracts/clients"
import { QueryProvider } from "@/lib/queries/provider"

const client: ClientSummary = {
  id: "c1",
  name: "Old Crown Group",
  slug: "old-crown-group",
  colour: null,
  logoUrl: null,
  notes: null,
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  locationCount: 1,
  linkedCount: 1,
  verifiedCount: 1,
  health: "healthy",
  connections: [],
  openWork: { needsReply: 0, awaitingApproval: 0, failed: 0 },
  backfill: { running: 0, failed: 0, succeeded: 1, notStarted: 0 },
  lastSyncAt: null,
}

const listing = (clientId: string | null) => ({
  locationId: "l1",
  name: "Old Crown Girton",
  address: null,
  timezone: "Europe/London",
  linkId: "ll1",
  externalLocationId: "e1",
  googleLocationName: "locations/1",
  googleTitle: "Old Crown Girton",
  verified: true,
  clientId,
  clientName: clientId ? "Old Crown Group" : null,
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function stub({
  attached,
  patch,
}: {
  attached: boolean
  patch?: () => Response
}) {
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    if (url.includes("/api/session"))
      return json({
        session: {
          userId: "u1",
          organisationId: "o1",
          organisationName: "Agency",
          displayName: "Owner",
          email: "owner@example.test",
          role: "owner",
          canPublish: true,
        },
      })
    if (url.includes("/api/location-links"))
      return json({ locations: [listing(attached ? "c1" : null)] })
    if (url.includes("/api/clients/c1") && init?.method === "PATCH")
      return patch ? patch() : json({ client })
    if (url.includes("/api/clients/c1")) return json({ client, locations: [] })
    return json({})
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  push.mockReset()
})

const renderSettings = () =>
  render(
    <QueryProvider>
      <Toaster>
        <ClientSettings clientId="c1" />
      </Toaster>
    </QueryProvider>
  )

describe("ClientSettings", () => {
  it("offers to unfile the listings and archive in one step", async () => {
    // Archiving used to be blocked until every listing was removed by hand,
    // one row at a time.
    const fetchMock = stub({ attached: true })
    renderSettings()
    expect(
      await screen.findByText(/still has its listing\. Archiving unfiles it/)
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: "Archive Old Crown Group" })
    )
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("checkbox"))
    const confirm = within(dialog).getByRole("button", {
      name: "Unfile its listing and archive",
    })
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)
    await waitFor(() => expect(push).toHaveBeenCalledWith("/clients"))
    const patch = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "PATCH"
    )
    expect(JSON.parse(String(patch?.[1]?.body))).toMatchObject({
      archived: true,
      detachLocations: true,
    })
    // The archive toast carries its own Undo.
    expect(
      await screen.findByRole("button", { name: "Undo" })
    ).toBeInTheDocument()
  })

  it("undoes a removal from the toast", async () => {
    const fetchMock = stub({ attached: true })
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes("/api/session"))
        return json({
          session: {
            userId: "u1",
            organisationId: "o1",
            organisationName: "Agency",
            displayName: "Owner",
            email: "owner@example.test",
            role: "owner",
            canPublish: true,
          },
        })
      if (url.includes("/api/location-links"))
        return json({ locations: [listing("c1")] })
      if (
        url.includes("/api/clients/c1/locations") &&
        init?.method === "DELETE"
      )
        return json({ unassigned: ["l1"] })
      if (url.includes("/api/clients/c1/locations") && init?.method === "POST")
        return json({ assigned: ["l1"] })
      if (url.includes("/api/clients/c1"))
        return json({ client, locations: [] })
      return json({ items: [client], unassignedLocationCount: 0 })
    })
    renderSettings()
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Remove Old Crown Girton from this client",
      })
    )
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }))
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).includes("/api/clients/c1/locations") &&
            init?.method === "POST"
        )
      ).toBe(true)
    )
    const refile = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).includes("/api/clients/c1/locations") &&
        init?.method === "POST"
    )
    expect(JSON.parse(String(refile?.[1]?.body))).toEqual({
      locationIds: ["l1"],
      grantToClientMembers: false,
    })
  })

  it("asks before filing more than five listings at once", async () => {
    const unfiled = Array.from({ length: 6 }, (_, index) => ({
      ...listing(null),
      locationId: `00000000-0000-4000-8000-00000000000${index}`,
      name: `Branch ${index}`,
      address: {
        addressLines: [`${index} High Street`],
        locality: "Cambridge",
      },
    }))
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes("/api/session"))
        return json({
          session: {
            userId: "u1",
            organisationId: "o1",
            organisationName: "Agency",
            displayName: "Owner",
            email: "owner@example.test",
            role: "owner",
            canPublish: true,
          },
        })
      if (url.includes("/api/location-links"))
        return json({ locations: unfiled })
      if (url.includes("/api/clients/c1"))
        return json({ client, locations: [] })
      return json({ items: [client], unassignedLocationCount: 6 })
    })
    vi.stubGlobal("fetch", fetchMock)
    renderSettings()
    // The address tells same-named branches apart, and the list filters.
    expect(await screen.findByText(/3 High Street/)).toBeInTheDocument()
    fireEvent.change(
      screen.getByRole("searchbox", {
        name: "Filter unfiled listings by name or address",
      }),
      { target: { value: "3 high" } }
    )
    expect(screen.queryByText("Branch 1")).not.toBeInTheDocument()
    fireEvent.change(
      screen.getByRole("searchbox", {
        name: "Filter unfiled listings by name or address",
      }),
      { target: { value: "" } }
    )
    fireEvent.click(await screen.findByRole("checkbox", { name: /Select all/ }))
    fireEvent.click(
      screen.getByRole("button", { name: "Add 6 to this client" })
    )
    const dialog = await screen.findByRole("alertdialog")
    expect(
      within(dialog).getByText(/File 6 listings under Old Crown Group/)
    ).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "POST")
    ).toBe(false)
  })

  it("asks for an acknowledgement before archiving an empty client", async () => {
    const fetchMock = stub({ attached: false })
    renderSettings()
    await screen.findByText(/can be archived/)
    fireEvent.click(
      screen.getByRole("button", { name: "Archive Old Crown Group" })
    )
    const dialog = await screen.findByRole("alertdialog")
    const confirm = within(dialog).getByRole("button", {
      name: "Archive Old Crown Group",
    })
    expect(confirm).toBeDisabled()
    fireEvent.click(within(dialog).getByRole("checkbox"))
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)
    await waitFor(() => expect(push).toHaveBeenCalledWith("/clients"))
    const patch = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "PATCH"
    )
    expect(JSON.parse(String(patch?.[1]?.body))).toMatchObject({
      archived: true,
    })
  })

  it("treats the server's post-archive reply as archived only once a re-read confirms it", async () => {
    // The real PATCH answers `{ client: null }` for an archived client (its
    // summary is no longer listed); the client endpoint then 404s.
    let archived = false
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url.includes("/api/session"))
        return json({
          session: {
            userId: "u1",
            organisationId: "o1",
            organisationName: "Agency",
            displayName: "Owner",
            email: "owner@example.test",
            role: "owner",
            canPublish: true,
          },
        })
      if (url.includes("/api/location-links"))
        return json({ locations: [listing(null)] })
      if (url.includes("/api/clients/c1") && init?.method === "PATCH") {
        archived = true
        return json({ client: null })
      }
      if (url.includes("/api/clients/c1"))
        return archived
          ? json({ error: "client_not_found", message: "Not found" }, 404)
          : json({ client, locations: [] })
      return json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    renderSettings()
    await screen.findByText(/can be archived/)
    fireEvent.click(
      screen.getByRole("button", { name: "Archive Old Crown Group" })
    )
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("checkbox"))
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Archive Old Crown Group" })
    )
    await waitFor(() => expect(push).toHaveBeenCalledWith("/clients"))
    expect(screen.queryByText(/wasn’t archived/)).not.toBeInTheDocument()
  })

  it("reports a failed archive when the client is still there", async () => {
    stub({ attached: false, patch: () => json({ client: null }) })
    renderSettings()
    await screen.findByText(/can be archived/)
    fireEvent.click(
      screen.getByRole("button", { name: "Archive Old Crown Group" })
    )
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("checkbox"))
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Archive Old Crown Group" })
    )
    expect(
      await within(dialog).findByText(/wasn’t archived/)
    ).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })

  it("keeps the edits in the form when a save fails", async () => {
    stub({
      attached: true,
      patch: () => json({ error: "server_error", message: "Boom" }, 500),
    })
    renderSettings()
    const name = await screen.findByLabelText("Client name")
    fireEvent.change(name, { target: { value: "Old Crown Pubs" } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    expect(await screen.findByText("Changes not saved")).toBeInTheDocument()
    expect(name).toHaveValue("Old Crown Pubs")
  })

  it("edits the colour with the details, and guards the unsaved change", async () => {
    const fetchMock = stub({ attached: true })
    renderSettings()
    fireEvent.click(await screen.findByRole("button", { name: /^Pine/ }))
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument()
    // Leaving through the page's own link asks first.
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
    fireEvent.click(
      screen.getByRole("link", { name: "Back to Old Crown Group" })
    )
    expect(confirm).toHaveBeenCalled()
    await waitFor(() => expect(push).not.toHaveBeenCalled())
    confirm.mockRestore()
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")
      ).toBe(true)
    )
    const patch = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "PATCH"
    )
    expect(JSON.parse(String(patch?.[1]?.body))).toMatchObject({
      colour: "#3F5E52",
    })
  })
})
