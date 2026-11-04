import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ChangeRoleDialog } from "@/components/settings/member-dialogs"
import type { Member } from "@/lib/api/members"
import { queryKeys } from "@/lib/queries/keys"
import { roleCapabilities } from "@/lib/settings/roles"

const ben: Member = {
  userId: "m-1",
  email: "ben@test",
  displayName: "Ben Member",
  role: "member",
  canPublish: false,
  locationScope: "all",
  createdAt: "2026-01-01T00:00:00.000Z",
  locations: [],
}

function renderDialog(member: Member, actorUserId = "owner-1") {
  const client = new QueryClient()
  client.setQueryData(queryKeys.session, {
    session: { workspaceMode: "agency" },
  })
  return render(
    <QueryClientProvider client={client}>
      <ChangeRoleDialog
        open
        member={member}
        actorRole="owner"
        actorUserId={actorUserId}
        pending={false}
        error={null}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />
    </QueryClientProvider>
  )
}

describe("roleCapabilities", () => {
  it("gives an owner every capability and nothing it can't do", () => {
    expect(roleCapabilities("owner").cannot).toEqual([])
  })

  it("keeps a conditional capability as a can, with its condition", () => {
    const member = roleCapabilities("member")
    expect(member.can).toContain(
      "Publish to Google: if publishing access is on"
    )
    expect(member.cannot).toContain("Manage the team and invitations")
  })
})

describe("ChangeRoleDialog role summary", () => {
  it("says nothing extra until a different role is picked", () => {
    renderDialog(ben)
    const dialog = screen.getByRole("dialog", { name: "Change role" })
    expect(dialog.querySelector("[data-slot=role-change-summary]")).toBeNull()
  })

  it("lists what the picked role can and can't do, in plain words", async () => {
    const user = userEvent.setup()
    renderDialog(ben)
    const dialog = screen.getByRole("dialog", { name: "Change role" })
    await user.click(within(dialog).getByRole("radio", { name: /^Viewer/ }))
    const summary = dialog.querySelector<HTMLElement>(
      "[data-slot=role-change-summary]"
    )!
    expect(within(summary).getByText("As a viewer, Ben can")).toBeVisible()
    expect(within(summary).getByText("Ben can’t")).toBeVisible()
    const lists = within(summary).getAllByRole("list")
    expect(within(lists[0]).getAllByRole("listitem")).toHaveLength(
      roleCapabilities("viewer").can.length
    )
    expect(within(lists[1]).getByText("Publish to Google")).toBeVisible()
    expect(
      within(dialog).getByRole("button", { name: "Make Ben a viewer" })
    ).toBeEnabled()
  })

  it("speaks to you on your own row", async () => {
    const user = userEvent.setup()
    renderDialog({ ...ben, userId: "owner-1", role: "owner" }, "owner-1")
    const dialog = screen.getByRole("dialog", { name: "Change role" })
    await user.click(within(dialog).getByRole("radio", { name: /^Admin/ }))
    const summary = dialog.querySelector<HTMLElement>(
      "[data-slot=role-change-summary]"
    )!
    expect(within(summary).getByText("As an admin, you can")).toBeVisible()
    expect(within(summary).getByText("You can’t")).toBeVisible()
    expect(within(summary).getByText("Change or remove an owner")).toBeVisible()
  })
})
