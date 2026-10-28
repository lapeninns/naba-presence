import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { InvitationView } from "@/components/auth/invitation-view"
import { QueryProvider } from "@/lib/queries/provider"
import { ApiClientError } from "@/lib/api/client"
import * as authApi from "@/lib/api/auth"
import { formatDateTime } from "@/lib/format"
import { invitationRoleSummary } from "@/lib/settings/roles"

// Fixed and far ahead so the mocks never drift into "expired".
const EXPIRES_AT = "2099-10-22T14:05:00.000Z"

const assign = vi.fn()
beforeEach(() => {
  vi.stubGlobal("location", {
    ...window.location,
    pathname: "/invite/tok",
    search: "",
    assign,
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  assign.mockReset()
})

function renderView(
  viewer: { displayName: string; email: string } | null = null
) {
  return render(
    <QueryProvider>
      <InvitationView token="tok" viewer={viewer} />
    </QueryProvider>
  )
}

describe("InvitationView", () => {
  it("shows the create-account form for a signed-out visitor", async () => {
    vi.spyOn(authApi, "lookupInvitation").mockResolvedValue({
      organisationName: "Lapen Inns",
      email: "invited@example.test",
      role: "member",
      expiresAt: EXPIRES_AT,
    })
    renderView()
    expect(
      await screen.findByRole("heading", { level: 1, name: "Join Lapen Inns" })
    ).toBeInTheDocument()
    const email = screen.getByLabelText("Email address")
    expect(email).toHaveValue("invited@example.test")
    expect(email).toHaveAttribute("readonly")
  })

  it("shows the role with what it can do, and when the link expires", async () => {
    vi.spyOn(authApi, "lookupInvitation").mockResolvedValue({
      organisationName: "Lapen Inns",
      email: "invited@example.test",
      role: "member",
      expiresAt: EXPIRES_AT,
    })
    renderView()
    await screen.findByRole("heading", { level: 1, name: "Join Lapen Inns" })

    // Value and caption sit under the row's name, so read the row whole.
    const role = screen.getByText("Role").closest("li, div")
    expect(role).toHaveTextContent("Member")
    expect(role).toHaveTextContent(invitationRoleSummary("member"))
    expect(
      screen.getByText("Drafts replies and posts; publishes only if allowed")
    ).toBeInTheDocument()

    // The expiry is shown in the visitor's own zone, so build the expected
    // text the same way instead of hard-coding a zone-dependent string.
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const expires = screen.getByText("Link expires").closest("li, div")
    expect(expires).toHaveTextContent(formatDateTime(EXPIRES_AT, timeZone))
  })

  it("words an admin invitation without naming clients or locations", async () => {
    vi.spyOn(authApi, "lookupInvitation").mockResolvedValue({
      organisationName: "Lapen Inns",
      email: "invited@example.test",
      role: "admin",
      expiresAt: EXPIRES_AT,
    })
    renderView()
    await screen.findByRole("heading", { level: 1, name: "Join Lapen Inns" })
    const role = screen.getByText("Role").closest("li, div")
    expect(role).toHaveTextContent("Admin")
    expect(role).toHaveTextContent("Manages the team and every listing")
  })

  it("keeps the role and expiry rows for a signed-in visitor", async () => {
    vi.spyOn(authApi, "lookupInvitation").mockResolvedValue({
      organisationName: "Lapen Inns",
      email: "invited@example.test",
      role: "viewer",
      expiresAt: EXPIRES_AT,
    })
    renderView({ displayName: "Aman Shrestha", email: "invited@example.test" })
    await screen.findByRole("button", { name: "Accept invitation" })
    expect(screen.getByText("Role").closest("li, div")).toHaveTextContent(
      "Viewer"
    )
    expect(screen.getByText("Link expires")).toBeInTheDocument()
    expect(screen.getByText("Signed in as")).toBeInTheDocument()
  })

  it("distinguishes an already-accepted invitation from an expired one", async () => {
    // A finished invitation answers with a code and no details (D8).
    vi.spyOn(authApi, "lookupInvitation").mockRejectedValue(
      new ApiClientError(409, "invitation_already_used", "x")
    )
    renderView()
    // Neutral about who accepted it: the link may have been forwarded.
    expect(
      await screen.findByText("This invitation has already been accepted.")
    ).toBeInTheDocument()
    expect(screen.getByText("Sign in to continue.")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute(
      "href",
      "/sign-in"
    )
    expect(screen.queryByText("Role")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Try again" })
    ).not.toBeInTheDocument()
  })

  it("sends a signed-in visitor from a dead end to the Inbox", async () => {
    vi.spyOn(authApi, "lookupInvitation").mockRejectedValue(
      new ApiClientError(409, "invitation_already_used", "x")
    )
    const { unmount } = renderView({
      displayName: "Aman Shrestha",
      email: "invited@example.test",
    })
    expect(
      await screen.findByText("This invitation has already been accepted.")
    ).toBeInTheDocument()
    // Already signed in, so no "Sign in to continue." and no sign-in link
    // that would only bounce on to the Inbox.
    expect(screen.queryByText("Sign in to continue.")).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Go to Inbox" })).toHaveAttribute(
      "href",
      "/inbox"
    )
    expect(
      screen.queryByRole("link", { name: "Go to sign in" })
    ).not.toBeInTheDocument()
    unmount()

    vi.spyOn(authApi, "lookupInvitation").mockRejectedValue(
      new ApiClientError(410, "invitation_expired", "x")
    )
    renderView({ displayName: "Aman Shrestha", email: "invited@example.test" })
    expect(
      await screen.findByText("That invitation has expired.")
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Go to Inbox" })).toHaveAttribute(
      "href",
      "/inbox"
    )
  })

  it("explains an expired invitation and offers a way out", async () => {
    vi.spyOn(authApi, "lookupInvitation").mockRejectedValue(
      new ApiClientError(410, "invitation_expired", "x")
    )
    renderView()
    expect(
      await screen.findByText("That invitation has expired.")
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Go to sign in" })
    ).toBeInTheDocument()
    expect(screen.queryByText("Role")).not.toBeInTheDocument()
    expect(screen.queryByText("Link expires")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Try again" })
    ).not.toBeInTheDocument()
  })

  it("separates a missing invitation from a network failure", async () => {
    vi.spyOn(authApi, "lookupInvitation").mockRejectedValue(
      new ApiClientError(404, "invitation_not_found", "x")
    )
    const { unmount } = renderView()
    expect(
      await screen.findByText("We could not find that invitation.")
    ).toBeInTheDocument()
    unmount()

    vi.spyOn(authApi, "lookupInvitation").mockRejectedValue(
      new ApiClientError(500, "internal_error", "x")
    )
    renderView()
    expect(
      await screen.findByText(
        "Accepting invitations is temporarily unavailable."
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Try again" })
    ).toBeInTheDocument()
  })

  it("moves focus to the title once a retried lookup settles", async () => {
    const user = userEvent.setup()
    const lookup = vi
      .spyOn(authApi, "lookupInvitation")
      .mockRejectedValue(new ApiClientError(500, "internal_error", "x"))
    renderView()
    let failAgain: (error: Error) => void = () => {}
    lookup.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          failAgain = reject
        })
    )
    await user.click(await screen.findByRole("button", { name: "Try again" }))
    // The skeleton replaces the button while the retry is out.
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Checking your invitation",
      })
    ).toBeInTheDocument()
    failAgain(new ApiClientError(500, "internal_error", "x"))
    // Failed again: the retry button came back, and focus is on the title
    // rather than left on <body> by the skeleton.
    await screen.findByRole("button", { name: "Try again" })
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: "Accept invitation" })
      ).toHaveFocus()
    )

    lookup.mockResolvedValue({
      organisationName: "Lapen Inns",
      email: "invited@example.test",
      role: "member",
      expiresAt: EXPIRES_AT,
    })
    await user.click(screen.getByRole("button", { name: "Try again" }))
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: "Join Lapen Inns" })
      ).toHaveFocus()
    )
  })

  it("keeps focus where it is on a first lookup", async () => {
    vi.spyOn(authApi, "lookupInvitation").mockRejectedValue(
      new ApiClientError(500, "internal_error", "x")
    )
    renderView()
    await screen.findByRole("button", { name: "Try again" })
    expect(
      screen.getByRole("heading", { level: 1, name: "Accept invitation" })
    ).not.toHaveFocus()
  })

  it("lets a visitor on the wrong account keep it", async () => {
    vi.spyOn(authApi, "lookupInvitation").mockResolvedValue({
      organisationName: "Lapen Inns",
      email: "invited@example.test",
      role: "member",
      expiresAt: EXPIRES_AT,
    })
    renderView({ displayName: "Aman Shrestha", email: "other@example.test" })
    expect(
      await screen.findByRole("link", { name: "Go to Inbox instead" })
    ).toHaveAttribute("href", "/inbox")
    // Exactly one primary: the sign-out is the only button.
    expect(screen.getAllByRole("button")).toHaveLength(1)
  })

  it("opens the form in sign-in mode when asked to", async () => {
    vi.spyOn(authApi, "lookupInvitation").mockResolvedValue({
      organisationName: "Lapen Inns",
      email: "invited@example.test",
      role: "member",
      expiresAt: EXPIRES_AT,
    })
    render(
      <QueryProvider>
        <InvitationView token="tok" viewer={null} initialMode="sign-in" />
      </QueryProvider>
    )
    expect(
      await screen.findByRole("button", {
        name: "Switch to sign in",
        pressed: true,
      })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/^Sign in with the invited address/)
    ).toBeInTheDocument()
  })

  it("words the description for the mode the form is in", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "lookupInvitation").mockResolvedValue({
      organisationName: "Lapen Inns",
      email: "invited@example.test",
      role: "member",
      expiresAt: EXPIRES_AT,
    })
    renderView()
    expect(
      await screen.findByText(
        "Set a password and you will be able to work on what Lapen Inns has given you access to."
      )
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Switch to sign in" }))
    expect(
      screen.getByText(
        "Sign in with the invited address and you will be able to work on what Lapen Inns has given you access to."
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/^Set a password and/)).not.toBeInTheDocument()

    await user.click(
      screen.getByRole("button", { name: "Switch to create account" })
    )
    expect(screen.getByText(/^Set a password and/)).toBeInTheDocument()
  })

  it("says who is signed in once, in the details", async () => {
    vi.spyOn(authApi, "lookupInvitation").mockResolvedValue({
      organisationName: "Lapen Inns",
      email: "invited@example.test",
      role: "member",
      expiresAt: EXPIRES_AT,
    })
    renderView({ displayName: "Aman Shrestha", email: "invited@example.test" })
    await screen.findByRole("button", { name: "Accept invitation" })
    expect(screen.queryByText(/^You are signed in as/)).not.toBeInTheDocument()
    expect(screen.getByText("Signed in as")).toBeInTheDocument()
  })

  it("shows an accept failure inline instead of navigating", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "lookupInvitation").mockResolvedValue({
      organisationName: "Lapen Inns",
      email: "invited@example.test",
      role: "member",
      expiresAt: EXPIRES_AT,
    })
    vi.spyOn(authApi, "acceptInvitation").mockRejectedValue(
      new ApiClientError(410, "invitation_expired", "x")
    )
    renderView({ displayName: "Aman Shrestha", email: "invited@example.test" })
    await user.click(
      await screen.findByRole("button", { name: "Accept invitation" })
    )
    expect(
      await screen.findByText("That invitation has expired.")
    ).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
  })

  it("shows the dead end when accepting finds the invitation finished", async () => {
    const user = userEvent.setup()
    const lookup = vi
      .spyOn(authApi, "lookupInvitation")
      .mockResolvedValueOnce({
        organisationName: "Lapen Inns",
        email: "invited@example.test",
        role: "member",
        expiresAt: EXPIRES_AT,
      })
      .mockRejectedValue(new ApiClientError(410, "invitation_expired", "x"))
    vi.spyOn(authApi, "acceptInvitation").mockRejectedValue(
      new ApiClientError(410, "invitation_expired", "x")
    )
    renderView({ displayName: "Aman Shrestha", email: "invited@example.test" })
    await user.click(
      await screen.findByRole("button", { name: "Accept invitation" })
    )
    // The lookup is asked again and its dead end replaces the details and
    // the Accept button that could never work.
    await waitFor(() => expect(lookup).toHaveBeenCalledTimes(2))
    expect(
      await screen.findByRole("link", { name: "Go to Inbox" })
    ).toHaveAttribute("href", "/inbox")
    expect(
      screen.queryByRole("button", { name: "Accept invitation" })
    ).not.toBeInTheDocument()
    expect(screen.queryByText("Role")).not.toBeInTheDocument()
    expect(screen.getByText("That invitation has expired.")).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
  })

  it("keeps a changed invitation in place after a failed accept", async () => {
    const user = userEvent.setup()
    const lookup = vi.spyOn(authApi, "lookupInvitation").mockResolvedValue({
      organisationName: "Lapen Inns",
      email: "invited@example.test",
      role: "member",
      expiresAt: EXPIRES_AT,
    })
    vi.spyOn(authApi, "acceptInvitation").mockRejectedValue(
      new ApiClientError(409, "invitation_changed", "x")
    )
    renderView({ displayName: "Aman Shrestha", email: "invited@example.test" })
    await user.click(
      await screen.findByRole("button", { name: "Accept invitation" })
    )
    expect(
      await screen.findByText(
        "This invitation changed while you were looking at it."
      )
    ).toBeInTheDocument()
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole("button", { name: "Accept invitation" })
    ).toBeInTheDocument()
  })
})
