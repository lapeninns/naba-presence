import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
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
    await user.click(await screen.findByRole("button", { name: "Share…" }))
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
      screen.queryByRole("button", { name: "Share…" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument()
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
    await user.click(screen.getByRole("radio", { name: /^Only these clients/ }))
    const list = screen.getByRole("list", { name: "Clients" })
    expect(list.className).not.toMatch(/overflow-y-auto|max-h-/)
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
