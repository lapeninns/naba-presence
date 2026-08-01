import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { InvitationView } from "@/components/auth/invitation-view"
import { QueryProvider } from "@/lib/queries/provider"
import { ApiClientError } from "@/lib/api/client"
import * as authApi from "@/lib/api/auth"

const assign = vi.fn()
beforeEach(() => {
  vi.stubGlobal("location", { ...window.location, pathname: "/invite/tok", search: "", assign })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  assign.mockReset()
})

function renderView(viewer: { displayName: string; email: string } | null = null) {
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
      accepted: false,
      expired: false,
    })
    renderView()
    expect(
      await screen.findByRole("heading", { level: 1, name: "Join Lapen Inns" })
    ).toBeInTheDocument()
    const email = screen.getByLabelText("Email address")
    expect(email).toHaveValue("invited@example.test")
    expect(email).toHaveAttribute("readonly")
  })

  it("distinguishes an already-accepted invitation from an expired one", async () => {
    vi.spyOn(authApi, "lookupInvitation").mockResolvedValue({
      organisationName: "Lapen Inns",
      email: "invited@example.test",
      accepted: true,
      expired: false,
    })
    renderView()
    expect(
      await screen.findByText("You have already accepted this invitation.")
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute(
      "href",
      "/sign-in"
    )
  })

  it("explains an expired invitation and offers a way out", async () => {
    vi.spyOn(authApi, "lookupInvitation").mockResolvedValue({
      organisationName: "Lapen Inns",
      email: "invited@example.test",
      accepted: false,
      expired: true,
    })
    renderView()
    expect(
      await screen.findByText("That invitation has expired.")
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Go to sign in" })).toBeInTheDocument()
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
      accepted: false,
      expired: false,
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
    expect(assign).toHaveBeenCalledWith("/invite/tok")
  })
})
