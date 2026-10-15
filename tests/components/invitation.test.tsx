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
    expect(
      await screen.findByText("You have already accepted this invitation.")
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute(
      "href",
      "/sign-in"
    )
    expect(screen.queryByText("Role")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Try again" })
    ).not.toBeInTheDocument()
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
    expect(await screen.findByText("Something went wrong.")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Try again" })
    ).toBeInTheDocument()
  })

  it("asks a signed-in visitor to sign out before continuing", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "lookupInvitation").mockResolvedValue({
      organisationName: "Lapen Inns",
      email: "invited@example.test",
      role: "member",
      expiresAt: EXPIRES_AT,
    })
    const signOutSpy = vi.spyOn(authApi, "signOut").mockResolvedValue(undefined)
    renderView({ displayName: "Aman Shrestha", email: "other@example.test" })
    expect(
      await screen.findByText(
        "You are signed in as other@example.test, but this invitation is for invited@example.test."
      )
    ).toBeInTheDocument()
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: "Sign out and continue" })
    )
    await waitFor(() => expect(signOutSpy).toHaveBeenCalled())
    // Back to the invite in sign-in mode: the invited address is someone
    // else's, and usually one that already has an account.
    expect(assign).toHaveBeenCalledWith(
      `${window.location.origin}/invite/tok?mode=sign-in`
    )
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
  })

  it("accepts with the current session when the signed-in email matches", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "lookupInvitation").mockResolvedValue({
      organisationName: "Lapen Inns",
      email: "invited@example.test",
      role: "member",
      expiresAt: EXPIRES_AT,
    })
    const signOutSpy = vi.spyOn(authApi, "signOut").mockResolvedValue(undefined)
    const acceptSpy = vi
      .spyOn(authApi, "acceptInvitation")
      .mockResolvedValue({ accepted: true, organisationId: "org-2" })
    renderView({ displayName: "Aman Shrestha", email: "Invited@example.test" })
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument()
    await user.click(
      await screen.findByRole("button", { name: "Accept invitation" })
    )
    await waitFor(() => expect(acceptSpy).toHaveBeenCalledWith("tok"))
    expect(signOutSpy).not.toHaveBeenCalled()
    expect(assign).toHaveBeenCalledWith(`${window.location.origin}/inbox`)
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
})
