import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MembersTable } from "@/components/settings/members-table"
import { Toaster } from "@/components/ui/toast"
import type { Member, MemberClientTotal } from "@/lib/api/members"

const useMembersMock = vi.fn()
vi.mock("@/lib/queries/use-members", () => ({ useMembers: () => useMembersMock() }))

function member(overrides: Partial<Member>): Member {
  return {
    userId: "u",
    email: "u@test",
    displayName: "User",
    role: "member",
    canPublish: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    locations: [],
    ...overrides,
  }
}

function renderTable(
  actorRole: Member["role"],
  actorUserId: string,
  members: Member[],
  clients?: MemberClientTotal[]
) {
  useMembersMock.mockReturnValue({ data: { members, clients }, isPending: false, isError: false, refetch: vi.fn() })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <MembersTable actorRole={actorRole} actorUserId={actorUserId} />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("MembersTable", () => {
  it("marks the current user, disables self-removal and last-owner demotion", async () => {
    const user = userEvent.setup()
    renderTable("owner", "owner-1", [
      member({ userId: "owner-1", displayName: "Ana Owner", email: "ana@test", role: "owner", canPublish: true }),
      member({ userId: "m-1", displayName: "Ben Member", email: "ben@test", role: "member" }),
    ])
    expect(screen.getByText("You")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Actions for Ana Owner" }))
    const remove = await screen.findByRole("menuitem", { name: /Remove from team/ })
    expect(remove).toHaveAttribute("aria-disabled", "true")
    expect(remove).toHaveAccessibleDescription("You can’t remove your own access.")
    const changeRole = screen.getByRole("menuitem", { name: /Change role/ })
    expect(changeRole).toHaveAttribute("aria-disabled", "true")
    expect(changeRole).toHaveAccessibleDescription(
      "Make someone else an owner before changing the last owner’s role."
    )
  })

  it("stops an admin from editing an owner row", async () => {
    const user = userEvent.setup()
    renderTable("admin", "admin-1", [
      member({ userId: "owner-1", displayName: "Ana Owner", email: "ana@test", role: "owner", canPublish: true }),
      member({ userId: "owner-2", displayName: "Omar Owner", email: "omar@test", role: "owner", canPublish: true }),
      member({ userId: "admin-1", displayName: "Al Admin", email: "al@test", role: "admin", canPublish: true }),
    ])
    await user.click(screen.getByRole("button", { name: "Actions for Ana Owner" }))
    const remove = await screen.findByRole("menuitem", { name: /Remove from team/ })
    expect(remove).toHaveAttribute("aria-disabled", "true")
    expect(remove).toHaveAccessibleDescription("Only an owner can remove an owner.")
  })

  it("never offers Owner to an admin changing a member's role", async () => {
    const user = userEvent.setup()
    renderTable("admin", "admin-1", [
      member({ userId: "admin-1", displayName: "Al Admin", email: "al@test", role: "admin", canPublish: true }),
      member({ userId: "m-1", displayName: "Ben Member", email: "ben@test", role: "member" }),
    ])
    await user.click(screen.getByRole("button", { name: "Actions for Ben Member" }))
    await user.click(await screen.findByRole("menuitem", { name: /Change role/ }))
    const dialog = await screen.findByRole("dialog", { name: "Change role" })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /^Admin/ })).toBeInTheDocument()
    expect(screen.queryByRole("radio", { name: /^Owner/ })).not.toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /^Member/ })).toBeChecked()
  })

  it("keeps viewers off publishing and says why", async () => {
    const user = userEvent.setup()
    renderTable("owner", "owner-1", [
      member({ userId: "owner-1", displayName: "Ana Owner", email: "ana@test", role: "owner", canPublish: true }),
      member({ userId: "v-1", displayName: "Val Viewer", email: "val@test", role: "viewer" }),
    ])
    expect(screen.getByText("View only")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Actions for Val Viewer" }))
    const publish = await screen.findByRole("menuitem", { name: /Allow publishing/ })
    expect(publish).toHaveAttribute("aria-disabled", "true")
    expect(publish).toHaveAccessibleDescription("Viewers can’t publish.")
  })

  it("summarises access by client instead of 'No listings assigned yet'", () => {
    renderTable(
      "owner",
      "owner-1",
      [
        member({ userId: "owner-1", displayName: "Ana Owner", email: "ana@test", role: "owner", canPublish: true }),
        member({ userId: "m-1", displayName: "Ben Member", email: "ben@test" }),
        member({
          userId: "m-2",
          displayName: "Cat Member",
          email: "cat@test",
          locations: [
            { locationId: "l1", canPublish: false, clientId: "c1" },
            { locationId: "l2", canPublish: false, clientId: "c1" },
            { locationId: "l3", canPublish: false, clientId: "c1" },
          ],
        }),
      ],
      [
        { clientId: "c1", name: "Old Crown", archived: false, total: 5 },
        { clientId: "c2", name: "The Bell", archived: false, total: 2 },
      ]
    )
    expect(screen.queryByText("No listings assigned yet")).not.toBeInTheDocument()
    expect(screen.getByText("Including clients added later")).toBeInTheDocument()
    expect(screen.getByText("Old Crown (3 of 5 listings)")).toBeInTheDocument()
  })

  it("offers Client access for members but not for owners or admins", async () => {
    const user = userEvent.setup()
    renderTable("owner", "owner-1", [
      member({ userId: "owner-1", displayName: "Ana Owner", email: "ana@test", role: "owner", canPublish: true }),
      member({ userId: "m-1", displayName: "Ben Member", email: "ben@test" }),
    ])
    await user.click(screen.getByRole("button", { name: "Actions for Ana Owner" }))
    const ownerItem = await screen.findByRole("menuitem", { name: /Client access/ })
    expect(ownerItem).toHaveAttribute("aria-disabled", "true")
    expect(ownerItem).toHaveAccessibleDescription("Owners and admins always see every client.")
    await user.keyboard("{Escape}")
    await user.click(screen.getByRole("button", { name: "Actions for Ben Member" }))
    const memberItem = await screen.findByRole("menuitem", { name: /Client access/ })
    expect(memberItem).not.toHaveAttribute("aria-disabled", "true")
  })
})
