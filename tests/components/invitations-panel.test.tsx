import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  InvitationsPanel,
  InviteDialog,
} from "@/components/settings/invitations-panel"
import { Toaster } from "@/components/ui/toast"
import * as invitationsApi from "@/lib/api/invitations"
import type { Invitation } from "@/lib/api/invitations"
import { ApiClientError } from "@/lib/api/client"

const useInvitationsMock = vi.fn()
vi.mock("@/lib/queries/use-invitations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries/use-invitations")>()),
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

function renderPanel(
  items: Invitation[],
  options: { emailDelivery?: boolean } = {}
) {
  useInvitationsMock.mockReturnValue({
    data: { items, emailDelivery: options.emailDelivery },
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

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  // jsdom has no share sheet; a test that adds one takes it away again.
  Reflect.deleteProperty(navigator, "share")
  Reflect.deleteProperty(navigator, "canShare")
})

describe("InvitationsPanel", () => {
  it("badges an expired invitation and offers copy + revoke", async () => {
    const user = userEvent.setup()
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
    ).toHaveAttribute("aria-disabled", "true")
    await user.click(
      screen.getByRole("button", { name: "More actions for chef@test" })
    )
    expect(
      await screen.findByRole("menuitem", {
        name: "Revoke invitation for chef@test",
      })
    ).toBeInTheDocument()
  })

  it("shows the create form with role rows and an email field", () => {
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
    // No share sheet here: Copy link is the one primary action.
    expect(
      screen.getByRole("button", { name: "Copy link" })
    ).toBeInTheDocument()
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
      screen.getByRole("button", { name: "More actions for chef@test" })
    )
    await user.click(
      await screen.findByRole("menuitem", {
        name: "Revoke invitation for chef@test",
      })
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

    // Closed by default, the row says what the default is.
    const access = screen.getByRole("button", { name: "Client access" })
    expect(access).toHaveAttribute("aria-expanded", "false")
    expect(access).toHaveAccessibleDescription(
      "All clients, including clients added later"
    )
    expect(
      screen.queryByRole("radio", { name: /^All clients/ })
    ).not.toBeInTheDocument()
    await user.click(access)
    expect(access).toHaveAttribute("aria-expanded", "true")
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
    // The refusal moves focus to the open Client access section.
    expect(screen.getByRole("group", { name: "Client access" })).toHaveFocus()
    // Closed again, a second refusal opens it and returns there.
    await user.click(access)
    expect(access).toHaveAttribute("aria-expanded", "false")
    await user.click(screen.getByRole("button", { name: "Create invite link" }))
    expect(access).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("group", { name: "Client access" })).toHaveFocus()

    expect(
      screen.getByRole("checkbox", { name: "New Client" })
    ).toHaveAttribute("aria-disabled", "true")
    await user.click(screen.getByRole("checkbox", { name: "Old Crown" }))
    expect(access).toHaveAccessibleDescription("1 client chosen")
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
    expect(
      screen.getByRole("button", { name: "Client access" })
    ).toBeInTheDocument()
    await user.click(screen.getByRole("radio", { name: /^Admin/ }))
    expect(
      screen.queryByRole("button", { name: "Client access" })
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

  it("offers the share sheet for a new link where the browser has one", async () => {
    const user = userEvent.setup()
    const share = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { share, canShare: () => true })
    vi.spyOn(invitationsApi, "createInvitation").mockResolvedValue({
      invitation: {
        id: "i5",
        email: "chef@test.com",
        role: "member",
        canPublish: false,
        expiresAt: "2099-01-01T00:00:00.000Z",
        acceptedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      inviteUrl: "https://app.test/invite/share",
    })
    renderPanel([])
    await user.type(
      screen.getByRole("textbox", { name: "Email address" }),
      "chef@test.com"
    )
    await user.click(screen.getByRole("button", { name: "Create invite link" }))
    await user.click(await screen.findByRole("button", { name: "Share" }))
    // Exactly the accept link and fixed wording: not the page URL, and not
    // the invitee's address.
    expect(share).toHaveBeenCalledTimes(1)
    expect(share).toHaveBeenCalledWith({
      url: "https://app.test/invite/share",
      title: "Join our team on NabaPresence",
      text: "Your invitation to join. The link works once and expires after 7 days.",
    })
    expect(JSON.stringify(share.mock.calls)).not.toContain("chef@test.com")
    // The link stays on screen whatever the share sheet did.
    expect(screen.getByRole("textbox", { name: "Invite link" })).toHaveValue(
      "https://app.test/invite/share"
    )
  })

  it("has no Share button without a share sheet", async () => {
    const user = userEvent.setup()
    vi.spyOn(invitationsApi, "createInvitation").mockResolvedValue({
      invitation: {
        id: "i6",
        email: "chef@test.com",
        role: "member",
        canPublish: false,
        expiresAt: "2099-01-01T00:00:00.000Z",
        acceptedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      inviteUrl: "https://app.test/invite/plain",
    })
    renderPanel([])
    await user.type(
      screen.getByRole("textbox", { name: "Email address" }),
      "chef@test.com"
    )
    await user.click(screen.getByRole("button", { name: "Create invite link" }))
    await screen.findByRole("textbox", { name: "Invite link" })
    expect(
      screen.queryByRole("button", { name: "Share" })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Copy link" })
    ).toBeInTheDocument()
  })

  it("shares a pending invitation's link from the row menu", async () => {
    const user = userEvent.setup()
    const share = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { share, canShare: () => true })
    renderPanel([
      {
        id: "i7",
        email: "chef@test",
        role: "member",
        canPublish: false,
        expiresAt: "2099-01-01T00:00:00.000Z",
        acceptedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        inviteUrl: "https://app.test/invite/row",
      },
    ])
    await user.click(
      screen.getByRole("button", { name: "More actions for chef@test" })
    )
    await user.click(
      await screen.findByRole("menuitem", { name: /Share invite link/ })
    )
    await waitFor(() =>
      expect(share).toHaveBeenCalledWith({
        url: "https://app.test/invite/row",
        title: "Join our team on NabaPresence",
        text: "Your invitation to join. The link works once and expires after 7 days.",
      })
    )
  })

  it("copies only the invite link when the share sheet refuses", async () => {
    const user = userEvent.setup()
    const share = vi
      .fn()
      .mockRejectedValue(new DOMException("blocked", "NotAllowedError"))
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { share, canShare: () => true })
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(writeText)
    renderPanel([
      {
        id: "i8",
        email: "chef@test",
        role: "member",
        canPublish: false,
        expiresAt: "2099-01-01T00:00:00.000Z",
        acceptedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        inviteUrl: "https://app.test/invite/fallback",
      },
    ])
    await user.click(
      screen.getByRole("button", { name: "More actions for chef@test" })
    )
    await user.click(
      await screen.findByRole("menuitem", { name: /Share invite link/ })
    )
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("https://app.test/invite/fallback")
    )
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(await screen.findByText("Invite link copied")).toBeInTheDocument()
  })

  it("does nothing more when the share sheet is closed", async () => {
    const user = userEvent.setup()
    const share = vi
      .fn()
      .mockRejectedValue(new DOMException("closed", "AbortError"))
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { share, canShare: () => true })
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(writeText)
    renderPanel([
      {
        id: "i9",
        email: "chef@test",
        role: "member",
        canPublish: false,
        expiresAt: "2099-01-01T00:00:00.000Z",
        acceptedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        inviteUrl: "https://app.test/invite/closed",
      },
    ])
    await user.click(
      screen.getByRole("button", { name: "More actions for chef@test" })
    )
    await user.click(
      await screen.findByRole("menuitem", { name: /Share invite link/ })
    )
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    expect(writeText).not.toHaveBeenCalled()
  })

  it("asks before an accidental dismissal throws a typed invitation away", async () => {
    const user = userEvent.setup()
    useInvitationsMock.mockReturnValue({
      data: { items: [] },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    const onOpenChange = vi.fn()
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <Toaster>
          <InviteDialog actorRole="owner" open onOpenChange={onOpenChange} />
        </Toaster>
      </QueryClientProvider>
    )
    await user.type(
      screen.getByRole("textbox", { name: "Email address" }),
      "half@test.com"
    )
    await user.keyboard("{Escape}")
    expect(
      await screen.findByRole("alertdialog", {
        name: "Discard this invitation?",
      })
    ).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false, expect.anything())
  })

  it("lists every client in the sheet's own scroll, with no inner scroll box", async () => {
    const user = userEvent.setup()
    renderPanel([])
    await user.click(screen.getByRole("button", { name: "Client access" }))
    await user.click(screen.getByRole("radio", { name: /^Only these clients/ }))
    const list = screen.getByRole("list", { name: "Clients" })
    expect(list.className).not.toMatch(/overflow-y-auto|max-h-/)
  })

  describe("the invite sheet", () => {
    function renderSheet() {
      useInvitationsMock.mockReturnValue({
        data: { items: [] },
        isPending: false,
        isError: false,
        refetch: vi.fn(),
      })
      useClientsMock.mockReturnValue({
        data: {
          items: [clientItem(CROWN, "Old Crown", 3)],
          unassignedLocationCount: 0,
        },
        isPending: false,
        isError: false,
        refetch: vi.fn(),
      })
      return render(
        <QueryClientProvider client={new QueryClient()}>
          <Toaster>
            <InviteDialog actorRole="owner" open onOpenChange={vi.fn()} />
          </Toaster>
        </QueryClientProvider>
      )
    }
    const created = {
      invitation: {
        id: "i7",
        email: "sheet@test.com",
        role: "member" as const,
        canPublish: false,
        expiresAt: "2099-01-01T00:00:00.000Z",
        acceptedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      inviteUrl: "https://app.test/invite/sheet",
    }
    const primaries = (dialog: HTMLElement) =>
      within(dialog)
        .getAllByRole("button")
        .filter((button) => button.getAttribute("data-variant") === "default")

    it("offers roles as rows, Member first, with Client access before the submit button", async () => {
      renderSheet()
      const dialog = await screen.findByRole("dialog", {
        name: "Invite a teammate",
      })
      const rows = within(
        within(dialog).getByRole("radiogroup", { name: "Role" })
      ).getAllByRole("radio")
      expect(
        rows.map(
          (row) => row.textContent?.match(/^(Member|Viewer|Admin|Owner)/)?.[0]
        )
      ).toEqual(["Member", "Viewer", "Admin", "Owner"])
      expect(rows[0]).toBeChecked()
      const access = within(dialog).getByRole("button", {
        name: "Client access",
      })
      const submit = within(dialog).getByRole("button", {
        name: "Create invite link",
      })
      expect(
        access.compareDocumentPosition(submit) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
      // Role first, then Client access, then Can publish.
      const publish = within(dialog).getByRole("switch", {
        name: "Can publish",
      })
      expect(
        rows[3]!.compareDocumentPosition(access) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
      expect(
        access.compareDocumentPosition(publish) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    })

    it("has one primary on success, Share, with Copy link as the secondary", async () => {
      const user = userEvent.setup()
      Object.assign(navigator, {
        share: vi.fn().mockResolvedValue(undefined),
        canShare: () => true,
      })
      vi.spyOn(invitationsApi, "createInvitation").mockResolvedValue(created)
      renderSheet()
      const dialog = await screen.findByRole("dialog", {
        name: "Invite a teammate",
      })
      await user.type(
        within(dialog).getByRole("textbox", { name: "Email address" }),
        "sheet@test.com"
      )
      await user.click(
        within(dialog).getByRole("button", { name: "Create invite link" })
      )
      await within(dialog).findByTestId("invite-created")
      expect(primaries(dialog).map((b) => b.textContent)).toEqual(["Share"])
      expect(
        within(dialog).getByRole("button", { name: "Copy link" })
      ).toHaveAttribute("data-variant", "secondary")
      expect(
        within(dialog).getByRole("button", { name: "Done" })
      ).toHaveAttribute("data-variant", "ghost")
      expect(
        within(dialog).getByRole("button", { name: "Invite someone else" })
      ).toHaveAttribute("data-variant", "link")
    })

    it("has Copy link as the one primary where there is no share sheet", async () => {
      const user = userEvent.setup()
      vi.spyOn(invitationsApi, "createInvitation").mockResolvedValue(created)
      renderSheet()
      const dialog = await screen.findByRole("dialog", {
        name: "Invite a teammate",
      })
      await user.type(
        within(dialog).getByRole("textbox", { name: "Email address" }),
        "sheet@test.com"
      )
      await user.click(
        within(dialog).getByRole("button", { name: "Create invite link" })
      )
      await within(dialog).findByTestId("invite-created")
      expect(primaries(dialog).map((b) => b.textContent)).toEqual(["Copy link"])
    })
  })

  describe("with invitation email on", () => {
    const pending = {
      role: "member" as const,
      canPublish: false,
      expiresAt: "2099-01-01T00:00:00.000Z",
      acceptedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    }
    const SENT = "22222222-2222-4222-8222-222222222222"
    const QUEUED = "33333333-3333-4333-8333-333333333333"
    const UNSENT = "44444444-4444-4444-8444-444444444444"

    function delivery(
      status: "pending" | "sent" | "failed" | "suppressed" | "uncertain",
      errorCode: string | null = null
    ) {
      return {
        id: `d-${status}`,
        kind: "initial" as const,
        status,
        errorCode,
        attempts: 1,
        sentAt: status === "sent" ? "2026-01-01T00:01:00.000Z" : null,
        createdAt: "2026-01-01T00:00:00.000Z",
      }
    }

    it("shows where each email stands, with Resend and the Copy link fallback", async () => {
      const user = userEvent.setup()
      const resend = vi
        .spyOn(invitationsApi, "resendInvitation")
        .mockResolvedValue({ delivery: delivery("sent") })
      renderPanel(
        [
          {
            ...pending,
            id: SENT,
            email: "sent@test",
            inviteUrl: "https://app.test/invite/a",
            delivery: delivery("sent"),
          },
          {
            ...pending,
            id: QUEUED,
            email: "queued@test",
            inviteUrl: "https://app.test/invite/b",
            delivery: delivery("pending"),
          },
          {
            ...pending,
            id: UNSENT,
            email: "unsent@test",
            inviteUrl: "https://app.test/invite/c",
            delivery: delivery("suppressed", "provider_not_configured"),
          },
        ],
        { emailDelivery: true }
      )

      expect(
        screen.getByRole("columnheader", { name: "Email" })
      ).toBeInTheDocument()
      expect(screen.getByText("Email sent")).toBeInTheDocument()
      expect(screen.getByText("Sending")).toBeInTheDocument()
      expect(screen.getByText("Not sent")).toBeInTheDocument()
      expect(
        screen.getByText(/Email isn’t set up for this workspace yet/)
      ).toBeInTheDocument()
      // The link is still there for the one that was not emailed.
      expect(
        screen.getByRole("button", { name: "Copy invite link for unsent@test" })
      ).toBeInTheDocument()

      // No second email while one is queued.
      expect(
        screen.getByRole("button", {
          name: "Resend invitation email to queued@test",
        })
      ).toHaveAttribute("aria-disabled", "true")

      await user.click(
        screen.getByRole("button", {
          name: "Resend invitation email to unsent@test",
        })
      )
      await waitFor(() => expect(resend).toHaveBeenCalledWith(UNSENT))
      expect(
        await screen.findByText("Invitation emailed to unsent@test")
      ).toBeInTheDocument()
    })

    it("says why a Resend was refused", async () => {
      const user = userEvent.setup()
      vi.spyOn(invitationsApi, "resendInvitation").mockRejectedValue(
        new ApiClientError(429, "invitation_email_rate_limited", "Too many")
      )
      renderPanel(
        [
          {
            ...pending,
            id: SENT,
            email: "sent@test",
            inviteUrl: "https://app.test/invite/a",
            delivery: delivery("failed", "email_http_422"),
          },
        ],
        { emailDelivery: true }
      )
      expect(screen.getByText("Email failed")).toBeInTheDocument()
      await user.click(
        screen.getByRole("button", {
          name: "Resend invitation email to sent@test",
        })
      )
      expect(
        await screen.findByText(/Too many invitation emails were sent/)
      ).toBeInTheDocument()
    })

    it("hides the email column and Resend while the feature is off", () => {
      renderPanel([
        {
          ...pending,
          id: SENT,
          email: "sent@test",
          inviteUrl: "https://app.test/invite/a",
        },
      ])
      expect(
        screen.queryByRole("columnheader", { name: "Email" })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: /Resend invitation email/ })
      ).not.toBeInTheDocument()
    })

    it("sends on create and keeps the link when the email was not sent", async () => {
      const user = userEvent.setup()
      vi.spyOn(invitationsApi, "createInvitation").mockResolvedValue({
        invitation: {
          ...pending,
          id: "i10",
          email: "chef@test.com",
          delivery: delivery("suppressed", "invitation_email_rate_limited"),
        },
        inviteUrl: "https://app.test/invite/fallback",
      })
      renderPanel([], { emailDelivery: true })
      await user.type(
        screen.getByRole("textbox", { name: "Email address" }),
        "chef@test.com"
      )
      await user.click(screen.getByRole("button", { name: "Send invitation" }))
      expect(
        await screen.findByText("Invitation created, but the email wasn’t sent")
      ).toBeInTheDocument()
      expect(screen.getByText(/Too many invitation emails/)).toBeInTheDocument()
      expect(screen.getByRole("textbox", { name: "Invite link" })).toHaveValue(
        "https://app.test/invite/fallback"
      )
    })

    it("confirms an emailed invitation", async () => {
      const user = userEvent.setup()
      vi.spyOn(invitationsApi, "createInvitation").mockResolvedValue({
        invitation: {
          ...pending,
          id: "i11",
          email: "chef@test.com",
          delivery: delivery("sent"),
        },
        inviteUrl: "https://app.test/invite/sent",
      })
      renderPanel([], { emailDelivery: true })
      await user.type(
        screen.getByRole("textbox", { name: "Email address" }),
        "chef@test.com"
      )
      await user.click(screen.getByRole("button", { name: "Send invitation" }))
      expect(await screen.findByText("Invitation emailed")).toBeInTheDocument()
    })
  })
})

// The viewport, as the shell's matchMedia answers it. Without a stub the
// list draws its desk face (useMediaQuery's server default).
function stubWidth(wide: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: wide,
      addEventListener: () => {},
      removeEventListener: () => {},
    })
  )
}

const expiredInvite: Invitation = {
  id: "i1",
  email: "catherine.smith@riverside-inns.example.test",
  role: "member",
  canPublish: false,
  expiresAt: "2020-01-01T00:00:00.000Z",
  acceptedAt: null,
  createdAt: "2019-12-25T00:00:00.000Z",
  inviteUrl: "https://app.test/invite/secret",
}

const pendingInvite: Invitation = {
  id: "i2",
  email: "chef@test",
  role: "viewer",
  canPublish: false,
  expiresAt: "2099-01-01T00:00:00.000Z",
  acceptedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  inviteUrl: "https://app.test/invite/other",
}

// p6-F13 B, D: invitations read like the member rows on a phone.
describe("InvitationsList on a phone", () => {
  it("lists pending invitations as rows with the same actions", async () => {
    const user = userEvent.setup()
    stubWidth(false)
    renderPanel([expiredInvite, pendingInvite])
    expect(
      screen.queryByRole("table", { name: "Pending invitations" })
    ).not.toBeInTheDocument()
    const list = screen.getByRole("list", { name: "Pending invitations" })
    const rows = within(list).getAllByRole("listitem")
    expect(rows).toHaveLength(2)
    // Expired once: the pill, then since when.
    expect(within(rows[0]).getAllByText(/Expired/)).toHaveLength(1)
    expect(
      within(rows[0]).getByText(/^All clients · Drafts only · Since /)
    ).toBeInTheDocument()
    expect(
      within(rows[1]).getByText(/^All clients · View only · Expires /)
    ).toBeInTheDocument()
    expect(within(rows[1]).getByText("Pending")).toBeInTheDocument()
    expect(
      within(rows[0]).getByRole("button", {
        name: "Copy invite link for catherine.smith@riverside-inns.example.test",
      })
    ).toHaveAttribute("aria-disabled", "true")
    await user.click(
      within(rows[1]).getByRole("button", {
        name: "More actions for chef@test",
      })
    )
    expect(
      await screen.findByRole("menuitem", {
        name: "Revoke invitation for chef@test",
      })
    ).toBeInTheDocument()
  })
})

describe("InvitationsList from md", () => {
  it("keeps the table and says Expired once", () => {
    stubWidth(true)
    renderPanel([expiredInvite])
    const table = screen.getByRole("table", { name: "Pending invitations" })
    expect(
      screen.queryByRole("list", { name: "Pending invitations" })
    ).not.toBeInTheDocument()
    expect(within(table).getAllByText(/Expired/)).toHaveLength(1)
    expect(within(table).getByText(/^Since /)).toBeInTheDocument()
  })
})

// p6-F14 2: an address wraps before its "@", never mid-word.
describe("invitation email wrapping", () => {
  it("offers a break before the @ in the row and the revoke title", async () => {
    const user = userEvent.setup()
    renderPanel([expiredInvite])
    const email = screen.getByText(
      "catherine.smith@riverside-inns.example.test"
    )
    expect(email.querySelector("wbr")).not.toBeNull()
    expect(email.className).toMatch(/overflow-wrap:break-word/)
    expect(email.className).not.toMatch(/overflow-wrap:anywhere/)
    await user.click(
      screen.getByRole("button", {
        name: "More actions for catherine.smith@riverside-inns.example.test",
      })
    )
    await user.click(
      await screen.findByRole("menuitem", {
        name: "Revoke invitation for catherine.smith@riverside-inns.example.test",
      })
    )
    const title = await screen.findByRole("heading", {
      name: "Revoke the invitation for catherine.smith@riverside-inns.example.test?",
    })
    expect(title.querySelector("wbr")).not.toBeNull()
  })
})

// p6-F14 1, 4: Can publish tells the truth for every role; the request
// does not change.
describe("the invite form's Can publish", () => {
  it("reads on and locked for Owner and Admin, with the hint as its description", async () => {
    const user = userEvent.setup()
    renderPanel([])
    const toggle = () => screen.getByRole("switch", { name: "Can publish" })
    expect(toggle()).not.toBeChecked()
    expect(toggle()).toHaveAccessibleDescription(
      "Off: drafts only, for someone else to publish."
    )
    for (const role of [/^Admin/, /^Owner/]) {
      await user.click(screen.getByRole("radio", { name: role }))
      expect(toggle()).toBeChecked()
      expect(toggle()).toHaveAttribute("aria-disabled", "true")
      expect(toggle()).toHaveAccessibleDescription(
        "Owners and admins can always publish."
      )
    }
    await user.click(screen.getByRole("radio", { name: /^Member/ }))
    expect(toggle()).not.toBeChecked()
    expect(toggle()).not.toHaveAttribute("aria-disabled", "true")
  })

  // The old rule, verbatim: canPublish is the switch's own state except for
  // a viewer. Every case must send exactly what it sent before.
  it.each([
    { label: "Member", toggle: false, role: "member", sent: false },
    { label: "Member", toggle: true, role: "member", sent: true },
    { label: "Viewer", toggle: true, role: "viewer", sent: false },
    { label: "Admin", toggle: false, role: "admin", sent: false },
    { label: "Admin", toggle: true, role: "admin", sent: true },
    { label: "Owner", toggle: false, role: "owner", sent: false },
    { label: "Owner", toggle: true, role: "owner", sent: true },
  ] as const)(
    "sends the same request as before for $label (switch turned on first: $toggle)",
    async ({ label, toggle, role, sent }) => {
      const user = userEvent.setup()
      const create = vi
        .spyOn(invitationsApi, "createInvitation")
        .mockRejectedValue(new ApiClientError(500, "internal", "Nope"))
      renderPanel([])
      await user.type(
        screen.getByRole("textbox", { name: "Email address" }),
        "new@test.com"
      )
      if (toggle)
        await user.click(screen.getByRole("switch", { name: "Can publish" }))
      if (label !== "Member")
        await user.click(
          screen.getByRole("radio", { name: new RegExp(`^${label}`) })
        )
      await user.click(
        screen.getByRole("button", { name: "Create invite link" })
      )
      await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
      expect(create.mock.calls[0]?.[0]).toStrictEqual({
        email: "new@test.com",
        role,
        canPublish: sent,
      })
    }
  )
})

// p6-F14 3: the server refuses a second open invitation, and an expired
// one still counts until it is revoked.
describe("re-inviting an address", () => {
  const refuse = () =>
    vi
      .spyOn(invitationsApi, "createInvitation")
      .mockRejectedValue(
        new ApiClientError(
          409,
          "invitation_pending",
          "There’s already a pending invitation for that email address."
        )
      )

  it("says to revoke the expired invitation first", async () => {
    const user = userEvent.setup()
    const create = refuse()
    renderPanel([expiredInvite])
    const email = screen.getByRole("textbox", { name: "Email address" })
    await user.type(email, "Catherine.Smith@riverside-inns.example.test")
    await user.click(screen.getByRole("button", { name: "Create invite link" }))
    expect(
      await screen.findByText(
        "An expired invitation for this address is still in the list. Revoke it from its ⋯ menu, then invite them again."
      )
    ).toBeInTheDocument()
    expect(email).toHaveFocus()
    // Same request as any other invitation (the form lowercases the
    // address): no pre-check, no extra field.
    expect(create.mock.calls[0]?.[0]).toStrictEqual({
      email: "catherine.smith@riverside-inns.example.test",
      role: "member",
      canPublish: false,
    })
  })

  it("keeps the usual words when the open invitation is still live", async () => {
    const user = userEvent.setup()
    refuse()
    renderPanel([pendingInvite])
    await user.type(
      screen.getByRole("textbox", { name: "Email address" }),
      "chef@test.com"
    )
    await user.click(screen.getByRole("button", { name: "Create invite link" }))
    expect(
      await screen.findByText(/already a pending invitation/)
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/An expired invitation for this address/)
    ).not.toBeInTheDocument()
  })
})
