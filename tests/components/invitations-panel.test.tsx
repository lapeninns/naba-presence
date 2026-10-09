import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { InvitationsPanel } from "@/components/settings/invitations-panel"
import { Toaster } from "@/components/ui/toast"
import * as invitationsApi from "@/lib/api/invitations"
import type { Invitation } from "@/lib/api/invitations"

const useInvitationsMock = vi.fn()
vi.mock("@/lib/queries/use-invitations", () => ({
  useInvitations: () => useInvitationsMock(),
}))
const useClientsMock = vi.fn()
vi.mock("@/lib/queries/use-clients", () => ({
  useClients: (options?: { enabled?: boolean }) => useClientsMock(options),
}))

const CROWN = "00000000-0000-4000-8000-00000000c001"
const EMPTY = "00000000-0000-4000-8000-00000000c003"

function clientItem(id: string, name: string, locationCount: number) {
  return { id, name, locationCount }
}

function renderPanel(items: Invitation[]) {
  useInvitationsMock.mockReturnValue({
    data: { items },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  })
  useClientsMock.mockReturnValue({
    data: {
      items: [
        clientItem(CROWN, "Old Crown", 3),
        clientItem(EMPTY, "New Client", 0),
      ],
      unassignedLocationCount: 0,
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <InvitationsPanel actorRole="owner" />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("InvitationsPanel", () => {
  it("badges an expired invitation and offers copy + revoke", () => {
    renderPanel([
      {
        id: "i1",
        email: "chef@test",
        role: "member",
        canPublish: false,
        expiresAt: "2020-01-01T00:00:00.000Z",
        acceptedAt: null,
        createdAt: "2019-12-25T00:00:00.000Z",
        inviteUrl: "https://app.test/invite/secret",
      },
    ])
    expect(screen.getByText("Expired")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Copy invite link for chef@test" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Revoke invitation for chef@test" })
    ).toBeInTheDocument()
  })

  it("shows the create form with role cards and an email field", () => {
    renderPanel([])
    expect(
      screen.getByRole("textbox", { name: "Email address" })
    ).toBeInTheDocument()
    expect(screen.getByRole("radiogroup", { name: "Role" })).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Create invite link" })
    ).toBeInTheDocument()
  })

  it("submits canPublish: false for a Viewer invitation even after the switch was turned on first", async () => {
    const user = userEvent.setup()
    const create = vi
      .spyOn(invitationsApi, "createInvitation")
      .mockResolvedValue({
        invitation: {
          id: "i2",
          email: "new@test.com",
          role: "viewer",
          canPublish: false,
          expiresAt: "2099-01-01T00:00:00.000Z",
          acceptedAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        inviteUrl: "https://app.test/invite/new",
      })
    renderPanel([])

    await user.type(
      screen.getByRole("textbox", { name: "Email address" }),
      "new@test.com"
    )
    await user.click(screen.getByRole("switch", { name: "Can publish" }))
    await user.click(screen.getByRole("radio", { name: /^Viewer/ }))
    expect(
      screen.getByRole("switch", { name: "Can publish" })
    ).not.toBeChecked()
    await user.click(screen.getByRole("button", { name: "Create invite link" }))

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        email: "new@test.com",
        role: "viewer",
        canPublish: false,
      })
    )
  })

  it("keeps the address and says why when the email is invalid", async () => {
    const user = userEvent.setup()
    const create = vi.spyOn(invitationsApi, "createInvitation")
    renderPanel([])
    await user.type(
      screen.getByRole("textbox", { name: "Email address" }),
      "not-an-email"
    )
    await user.click(screen.getByRole("button", { name: "Create invite link" }))
    expect(create).not.toHaveBeenCalled()
    const email = screen.getByRole("textbox", { name: "Email address" })
    expect(email).toHaveValue("not-an-email")
    expect(email).toHaveAttribute("aria-invalid", "true")
  })

  it("keeps the new invite link on screen with a copy button", async () => {
    const user = userEvent.setup()
    vi.spyOn(invitationsApi, "createInvitation").mockResolvedValue({
      invitation: {
        id: "i3",
        email: "chef@test.com",
        role: "member",
        canPublish: false,
        expiresAt: "2099-01-01T00:00:00.000Z",
        acceptedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      inviteUrl: "https://app.test/invite/fresh",
    })
    renderPanel([])
    await user.type(
      screen.getByRole("textbox", { name: "Email address" }),
      "chef@test.com"
    )
    await user.click(screen.getByRole("button", { name: "Create invite link" }))
    const link = await screen.findByRole("textbox", { name: "Invite link" })
    expect(link).toHaveValue("https://app.test/invite/fresh")
    expect(link).toHaveAttribute("readonly")
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: "Invite someone else" })
    )
    expect(screen.getByRole("textbox", { name: "Email address" })).toHaveValue(
      ""
    )
  })

  it("asks before revoking an invitation", async () => {
    const user = userEvent.setup()
    const revoke = vi
      .spyOn(invitationsApi, "revokeInvitation")
      .mockResolvedValue({ revoked: true })
    renderPanel([
      {
        id: "11111111-1111-4111-8111-111111111111",
        email: "chef@test",
        role: "member",
        canPublish: false,
        expiresAt: "2099-01-01T00:00:00.000Z",
        acceptedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        inviteUrl: "https://app.test/invite/secret",
      },
    ])
    await user.click(
      screen.getByRole("button", { name: "Revoke invitation for chef@test" })
    )
    expect(revoke).not.toHaveBeenCalled()
    await user.click(
      await screen.findByRole("button", { name: "Revoke invitation" })
    )
    await waitFor(() =>
      expect(revoke).toHaveBeenCalledWith(
        "11111111-1111-4111-8111-111111111111"
      )
    )
  })

  it("invites for all clients by default and can scope to chosen clients", async () => {
    const user = userEvent.setup()
    const create = vi
      .spyOn(invitationsApi, "createInvitation")
      .mockResolvedValue({
        invitation: {
          id: "i9",
          email: "ben@test.com",
          role: "member",
          canPublish: false,
          clients: [{ id: CROWN, name: "Old Crown" }],
          expiresAt: "2099-01-01T00:00:00.000Z",
          acceptedAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        inviteUrl: "https://app.test/invite/scoped",
      })
    renderPanel([])

    expect(screen.getByRole("radio", { name: /^All clients/ })).toBeChecked()
    await user.type(
      screen.getByRole("textbox", { name: "Email address" }),
      "ben@test.com"
    )
    await user.click(screen.getByRole("radio", { name: /^Only these clients/ }))
    expect(useClientsMock).toHaveBeenLastCalledWith({ enabled: true })

    // Nothing ticked: refused in the form rather than sent as "everything".
    await user.click(screen.getByRole("button", { name: "Create invite link" }))
    expect(create).not.toHaveBeenCalled()
    expect(
      screen.getByText("Tick at least one client, or choose All clients.")
    ).toBeInTheDocument()

    expect(
      screen.getByRole("checkbox", { name: "New Client" })
    ).toHaveAttribute("aria-disabled", "true")
    await user.click(screen.getByRole("checkbox", { name: "Old Crown" }))
    await user.click(screen.getByRole("button", { name: "Create invite link" }))
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        email: "ben@test.com",
        role: "member",
        canPublish: false,
        clientIds: [CROWN],
      })
    )
    expect(await screen.findByText(/Old Crown\. Send/)).toBeInTheDocument()
  })

  it("hides the client choice for an admin invitation", async () => {
    const user = userEvent.setup()
    renderPanel([])
    await user.click(screen.getByRole("radio", { name: /^Admin/ }))
    expect(
      screen.queryByRole("radio", { name: /^Only these clients/ })
    ).not.toBeInTheDocument()
  })

  it("shows each pending invitation's client scope", () => {
    renderPanel([
      {
        id: "i4",
        email: "scoped@test",
        role: "viewer",
        canPublish: false,
        clients: [{ id: CROWN, name: "Old Crown" }],
        expiresAt: "2099-01-01T00:00:00.000Z",
        acceptedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ])
    expect(screen.getByText("Old Crown")).toBeInTheDocument()
  })
})
