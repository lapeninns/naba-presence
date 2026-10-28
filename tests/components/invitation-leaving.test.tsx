import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { InvitationView } from "@/components/auth/invitation-view"
import { QueryProvider } from "@/lib/queries/provider"
import { ApiClientError } from "@/lib/api/client"
import * as authApi from "@/lib/api/auth"

// The ways off an invitation by full navigation: accepting, and signing out
// of the wrong account. Both hold their button busy until the page leaves
// with an action that never resolves, and React entangles every async
// transition with the one still pending, so any later transition in the
// same file would stay pending too. Hence a file of their own, after which
// nothing else runs.

const EXPIRES_AT = "2099-10-22T14:05:00.000Z"
const INVITATION = {
  organisationName: "Lapen Inns",
  email: "invited@example.test",
  role: "member",
  expiresAt: EXPIRES_AT,
} as const

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

// Lets a transition that was going to finish do so before the assertions.
const settle = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, 20)))

function renderView(viewer: { displayName: string; email: string }) {
  return render(
    <QueryProvider>
      <InvitationView token="tok" viewer={viewer} />
    </QueryProvider>
  )
}

describe("InvitationView leaving the page", () => {
  it("asks a signed-in visitor to sign out before continuing", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "lookupInvitation").mockResolvedValue(INVITATION)
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
    await settle()
    // Still busy while the page leaves, so it can't be pressed again.
    const button = screen.getByRole("button", { name: "Signing out…" })
    expect(button).toHaveAttribute("aria-busy", "true")
    await user.click(button)
    expect(signOutSpy).toHaveBeenCalledTimes(1)
  })

  it("still leaves for the invite when signing out fails", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "lookupInvitation").mockResolvedValue(INVITATION)
    vi.spyOn(authApi, "signOut").mockRejectedValue(
      new ApiClientError(500, "internal_error", "x")
    )
    renderView({ displayName: "Aman Shrestha", email: "other@example.test" })
    await user.click(
      await screen.findByRole("button", { name: "Sign out and continue" })
    )
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        `${window.location.origin}/invite/tok?mode=sign-in`
      )
    )
  })

  it("accepts with the current session when the signed-in email matches", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "lookupInvitation").mockResolvedValue(INVITATION)
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
    await settle()
    // The button never comes back while the page leaves: it stays busy and
    // focused, and a second press does not accept again.
    const button = screen.getByRole("button", { name: "Accepting…" })
    expect(button).toHaveAttribute("aria-busy", "true")
    expect(button).toHaveFocus()
    await user.click(button)
    expect(acceptSpy).toHaveBeenCalledTimes(1)
  })
})
