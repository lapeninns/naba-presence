import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { InvitationsPanel } from "@/components/settings/invitations-panel"
import { Toaster } from "@/components/ui/toast"
import * as invitationsApi from "@/lib/api/invitations"
import type { Invitation } from "@/lib/api/invitations"

const useInvitationsMock = vi.fn()
vi.mock("@/lib/queries/use-invitations", () => ({ useInvitations: () => useInvitationsMock() }))

function renderPanel(items: Invitation[]) {
  useInvitationsMock.mockReturnValue({ data: { items }, isPending: false, isError: false, refetch: vi.fn() })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
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
    expect(screen.getByRole("button", { name: "Copy invite link for chef@test" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Revoke invitation for chef@test" })).toBeInTheDocument()
  })

  it("shows the create form with a role select and an email field", () => {
    renderPanel([])
    expect(screen.getByRole("textbox", { name: "Email address" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Send invitation" })).toBeInTheDocument()
  })

  it("submits canPublish: false for a Viewer invitation even after the switch was turned on first", async () => {
    const user = userEvent.setup()
    const create = vi.spyOn(invitationsApi, "createInvitation").mockResolvedValue({
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

    await user.type(screen.getByRole("textbox", { name: "Email address" }), "new@test.com")
    await user.click(screen.getByRole("switch", { name: "Can publish" }))
    await user.click(screen.getByRole("combobox", { name: "Invitation role" }))
    await user.click(await screen.findByRole("option", { name: "Viewer" }))
    await user.click(screen.getByRole("button", { name: "Send invitation" }))

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ email: "new@test.com", role: "viewer", canPublish: false })
    )
  })
})
