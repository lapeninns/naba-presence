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
  it("blocks archiving, in words, while listings are attached", async () => {
    stub({ attached: true })
    renderSettings()
    expect(
      await screen.findByText(
        "Archiving is blocked while listings are attached."
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Archive Old Crown Group" })
    ).toHaveAttribute("aria-disabled", "true")
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
          ? json(
              { error: "client_not_found", message: "Not found" },
              404
            )
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
})
