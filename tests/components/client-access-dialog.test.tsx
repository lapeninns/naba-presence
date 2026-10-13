import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ClientAccessDialog } from "@/components/settings/client-access-dialog"
import { Toaster } from "@/components/ui/toast"
import * as membersApi from "@/lib/api/members"
import type { Member } from "@/lib/api/members"
import { queryKeys } from "@/lib/queries/keys"
import type {
  ClientAccessResponse,
  ClientAccessRow,
} from "@/lib/contracts/client-access"

const useClientAccessMock = vi.fn()
vi.mock("@/lib/queries/use-members", () => ({
  useClientAccess: () => useClientAccessMock(),
}))

const useLocationDirectoryMock = vi.fn()
vi.mock("@/lib/queries/use-locations", () => ({
  useLocationDirectory: (role: string) => useLocationDirectoryMock(role),
}))

const CROWN = "00000000-0000-4000-8000-00000000c001"
const BELL = "00000000-0000-4000-8000-00000000c002"
const EMPTY = "00000000-0000-4000-8000-00000000c003"

const ben: Member = {
  userId: "00000000-0000-4000-8000-0000000000b1",
  email: "ben@test",
  displayName: "Ben Member",
  role: "member",
  canPublish: false,
  locationScope: "all",
  createdAt: "2026-01-01T00:00:00.000Z",
  locations: [],
}

function row(
  overrides: Partial<ClientAccessRow> & { clientId: string; name: string }
): ClientAccessRow {
  return {
    archived: false,
    total: 1,
    granted: 0,
    publishing: "none",
    ...overrides,
  }
}

function access(
  overrides: Partial<ClientAccessResponse> = {}
): ClientAccessResponse {
  return {
    userId: ben.userId,
    role: "member",
    allClients: true,
    noAccess: false,
    clients: [
      row({ clientId: CROWN, name: "Old Crown", total: 5 }),
      row({ clientId: BELL, name: "The Bell", total: 2 }),
      row({ clientId: EMPTY, name: "New Client", total: 0 }),
    ],
    locationGrants: [],
    ...overrides,
  }
}

function renderDialog(
  data: ClientAccessResponse,
  member: Member = ben,
  mode: "agency" | "business" = "agency"
) {
  useClientAccessMock.mockReturnValue({
    data,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  if (mode === "business") {
    client.setQueryData(queryKeys.session, {
      session: { workspaceMode: "business" },
    })
  }
  const onOpenChange = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <Toaster>
        <ClientAccessDialog open member={member} onOpenChange={onOpenChange} />
      </Toaster>
    </QueryClientProvider>
  )
  return { onOpenChange }
}

afterEach(() => vi.restoreAllMocks())

describe("ClientAccessDialog", () => {
  it("makes All clients an explicit choice and warns before narrowing", async () => {
    const user = userEvent.setup()
    const save = vi
      .spyOn(membersApi, "updateClientAccess")
      .mockResolvedValue(access({ allClients: false }))
    const { onOpenChange } = renderDialog(access())

    expect(
      screen.getByRole("radio", {
        name: /All clients, including ones added later/,
      })
    ).toBeChecked()
    expect(screen.getByTestId("access-consequence")).toHaveTextContent(
      "Ben will see every client and listing, including clients added later."
    )
    expect(screen.getByRole("button", { name: "Save access" })).toBeDisabled()

    await user.click(screen.getByRole("radio", { name: /Only these clients/ }))
    // Nothing ticked yet: that saves as no access, and says so, never as
    // "everything".
    expect(screen.getByTestId("access-consequence")).toHaveTextContent(
      "Ben will see no clients or listings until you give them access."
    )
    expect(screen.getByText("This removes Ben’s access")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save access" })).toBeEnabled()
    // A client with no listings can't be ticked.
    expect(
      screen.getByRole("checkbox", { name: "New Client" })
    ).toHaveAttribute("aria-disabled", "true")

    await user.click(screen.getByRole("checkbox", { name: "Old Crown" }))
    await user.click(
      screen.getByRole("switch", { name: "Can publish to Old Crown" })
    )
    expect(screen.getByTestId("access-consequence")).toHaveTextContent(
      "Ben will see 1 client (5 listings): Old Crown. The other client is hidden from them, and so are clients added later."
    )
    expect(screen.getByText("This narrows Ben’s access")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Save access" }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(ben.userId, {
        clients: [{ clientId: CROWN, listings: "all", canPublish: true }],
      })
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it("keeps a legacy partial grant as it is unless the admin changes that client", async () => {
    const user = userEvent.setup()
    const save = vi
      .spyOn(membersApi, "updateClientAccess")
      .mockResolvedValue(access({ allClients: false }))
    renderDialog(
      access({
        allClients: false,
        clients: [
          row({
            clientId: CROWN,
            name: "Old Crown",
            total: 5,
            granted: 3,
            publishing: "some",
          }),
          row({ clientId: BELL, name: "The Bell", total: 2 }),
        ],
      })
    )

    expect(
      screen.getByRole("radio", { name: /Only these clients/ })
    ).toBeChecked()
    expect(
      screen.getByText("Some listings: 3 of 5, kept as they are")
    ).toBeInTheDocument()
    expect(screen.getByText("Publishes to some")).toBeInTheDocument()

    await user.click(screen.getByRole("checkbox", { name: "The Bell" }))
    await user.click(screen.getByRole("button", { name: "Save access" }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(ben.userId, {
        clients: [
          { clientId: CROWN, listings: "unchanged" },
          { clientId: BELL, listings: "all" },
        ],
      })
    )
  })

  it("can widen a partial client to all its listings", async () => {
    const user = userEvent.setup()
    const save = vi
      .spyOn(membersApi, "updateClientAccess")
      .mockResolvedValue(access({ allClients: false }))
    renderDialog(
      access({
        allClients: false,
        clients: [
          row({ clientId: CROWN, name: "Old Crown", total: 5, granted: 3 }),
        ],
      })
    )
    await user.click(screen.getByRole("button", { name: "Give all 5" }))
    await user.click(screen.getByRole("button", { name: "Save access" }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(ben.userId, {
        clients: [{ clientId: CROWN, listings: "all" }],
      })
    )
  })

  it("warns when widening a scoped member to All clients and saves it by name", async () => {
    const user = userEvent.setup()
    const save = vi
      .spyOn(membersApi, "updateClientAccess")
      .mockResolvedValue(access())
    renderDialog(
      access({
        allClients: false,
        clients: [
          row({ clientId: BELL, name: "The Bell", total: 2, granted: 2 }),
        ],
      })
    )
    await user.click(
      screen.getByRole("radio", {
        name: /All clients, including ones added later/,
      })
    )
    expect(screen.getByText("This widens Ben’s access")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Save access" }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(ben.userId, { allClients: true })
    )
  })

  it("offers no publishing switch for a viewer", async () => {
    const user = userEvent.setup()
    renderDialog(access({ role: "viewer" }), { ...ben, role: "viewer" })
    await user.click(screen.getByRole("radio", { name: /Only these clients/ }))
    await user.click(screen.getByRole("checkbox", { name: "Old Crown" }))
    expect(screen.queryByRole("switch")).not.toBeInTheDocument()
    expect(
      screen.getByText("Viewers can’t publish, whichever clients they see.")
    ).toBeInTheDocument()
  })

  it("searches when there are more than eight clients", async () => {
    const user = userEvent.setup()
    renderDialog(
      access({
        allClients: false,
        clients: Array.from({ length: 9 }, (_, index) =>
          row({
            clientId: `00000000-0000-4000-8000-0000000001${index.toString().padStart(2, "0")}`,
            name: index === 4 ? "Railway Tavern" : `Client ${index}`,
            total: 1,
            granted: index === 0 ? 1 : 0,
          })
        ),
      })
    )
    await user.type(
      screen.getByRole("searchbox", { name: "Search clients" }),
      "rail"
    )
    expect(
      screen.getByRole("checkbox", { name: "Railway Tavern" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("checkbox", { name: "Client 1" })
    ).not.toBeInTheDocument()
  })

  it("shows the server's refusal and keeps the dialog open", async () => {
    const user = userEvent.setup()
    vi.spyOn(membersApi, "updateClientAccess").mockRejectedValue(
      new Error("boom")
    )
    const { onOpenChange } = renderDialog(access())
    await user.click(screen.getByRole("radio", { name: /Only these clients/ }))
    await user.click(screen.getByRole("checkbox", { name: "The Bell" }))
    await user.click(screen.getByRole("button", { name: "Save access" }))
    expect(await screen.findByText("Access wasn’t changed")).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})

describe("ClientAccessDialog in business mode (location access)", () => {
  const OAK = "00000000-0000-4000-8000-0000000000l1"
  const ELM = "00000000-0000-4000-8000-0000000000l2"
  function directory() {
    useLocationDirectoryMock.mockReturnValue({
      data: [
        { id: OAK, name: "Oak Street", linked: true },
        { id: ELM, name: "Elm Road", linked: true },
      ],
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
  }

  it("ticks locations and saves them with publishing for a member", async () => {
    const user = userEvent.setup()
    directory()
    const save = vi
      .spyOn(membersApi, "updateClientAccess")
      .mockResolvedValue(access({ allClients: false }))
    renderDialog(access(), ben, "business")
    expect(useLocationDirectoryMock).toHaveBeenCalledWith("owner")

    await user.click(
      screen.getByRole("radio", { name: /Only these locations/ })
    )
    await user.click(screen.getByRole("checkbox", { name: "Oak Street" }))
    await user.click(
      screen.getByRole("switch", { name: "Can publish to Oak Street" })
    )
    expect(screen.getByTestId("access-consequence")).toHaveTextContent(
      "Ben will see 1 location. Locations added later stay hidden from them."
    )
    await user.click(screen.getByRole("button", { name: "Save access" }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(ben.userId, {
        locations: [{ locationId: OAK, canPublish: true }],
      })
    )
  })

  it("saves a viewer's locations without a publishing flag", async () => {
    const user = userEvent.setup()
    directory()
    const save = vi
      .spyOn(membersApi, "updateClientAccess")
      .mockResolvedValue(access({ allClients: false, role: "viewer" }))
    renderDialog(
      access({
        role: "viewer",
        allClients: false,
        locationGrants: [{ locationId: ELM, canPublish: false }],
      }),
      { ...ben, role: "viewer" },
      "business"
    )
    expect(screen.queryByRole("switch")).not.toBeInTheDocument()
    await user.click(screen.getByRole("checkbox", { name: "Oak Street" }))
    await user.click(screen.getByRole("button", { name: "Save access" }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(ben.userId, {
        locations: [{ locationId: ELM }, { locationId: OAK }],
      })
    )
  })
})
