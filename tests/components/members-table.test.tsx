import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MembersTable } from "@/components/settings/members-table"
import { Toaster } from "@/components/ui/toast"
import * as membersApi from "@/lib/api/members"
import type { Member, MemberClientTotal } from "@/lib/api/members"

const useMembersMock = vi.fn()
vi.mock("@/lib/queries/use-members", () => ({
  useMembers: () => useMembersMock(),
}))

function member(overrides: Partial<Member>): Member {
  return {
    userId: "u",
    email: "u@test",
    displayName: "User",
    role: "member",
    canPublish: false,
    // The database names a member or viewer holding rows 'assigned' (0083).
    locationScope:
      (overrides.locations?.length ?? 0) > 0 &&
      overrides.role !== "owner" &&
      overrides.role !== "admin"
        ? "assigned"
        : "all",
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
  useMembersMock.mockReturnValue({
    data: { members, clients },
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
        <MembersTable actorRole={actorRole} actorUserId={actorUserId} />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe("MembersTable", () => {
  it("marks the current user, disables self-removal and last-owner demotion", async () => {
    const user = userEvent.setup()
    renderTable("owner", "owner-1", [
      member({
        userId: "owner-1",
        displayName: "Ana Owner",
        email: "ana@test",
        role: "owner",
        canPublish: true,
      }),
      member({
        userId: "m-1",
        displayName: "Ben Member",
        email: "ben@test",
        role: "member",
      }),
    ])
    expect(screen.getByText("You")).toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: "Actions for Ana Owner" })
    )
    const remove = await screen.findByRole("menuitem", {
      name: /Remove from team/,
    })
    expect(remove).toHaveAttribute("aria-disabled", "true")
    expect(remove).toHaveAccessibleDescription(
      "You can’t remove your own access."
    )
    const changeRole = screen.getByRole("menuitem", { name: /Change role/ })
    expect(changeRole).toHaveAttribute("aria-disabled", "true")
    expect(changeRole).toHaveAccessibleDescription(
      "Make someone else an owner before changing the last owner’s role."
    )
  })

  it("stops an admin from editing an owner row", async () => {
    const user = userEvent.setup()
    renderTable("admin", "admin-1", [
      member({
        userId: "owner-1",
        displayName: "Ana Owner",
        email: "ana@test",
        role: "owner",
        canPublish: true,
      }),
      member({
        userId: "owner-2",
        displayName: "Omar Owner",
        email: "omar@test",
        role: "owner",
        canPublish: true,
      }),
      member({
        userId: "admin-1",
        displayName: "Al Admin",
        email: "al@test",
        role: "admin",
        canPublish: true,
      }),
    ])
    await user.click(
      screen.getByRole("button", { name: "Actions for Ana Owner" })
    )
    const remove = await screen.findByRole("menuitem", {
      name: /Remove from team/,
    })
    expect(remove).toHaveAttribute("aria-disabled", "true")
    expect(remove).toHaveAccessibleDescription(
      "Only an owner can remove an owner."
    )
  })

  it("never offers Owner to an admin changing a member's role", async () => {
    const user = userEvent.setup()
    renderTable("admin", "admin-1", [
      member({
        userId: "admin-1",
        displayName: "Al Admin",
        email: "al@test",
        role: "admin",
        canPublish: true,
      }),
      member({
        userId: "m-1",
        displayName: "Ben Member",
        email: "ben@test",
        role: "member",
      }),
    ])
    await user.click(
      screen.getByRole("button", { name: "Actions for Ben Member" })
    )
    await user.click(
      await screen.findByRole("menuitem", { name: /Change role/ })
    )
    const dialog = await screen.findByRole("dialog", { name: "Change role" })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /^Admin/ })).toBeInTheDocument()
    expect(
      screen.queryByRole("radio", { name: /^Owner/ })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /^Member/ })).toBeChecked()
  })

  it("keeps viewers off publishing and says why", () => {
    renderTable("owner", "owner-1", [
      member({
        userId: "owner-1",
        displayName: "Ana Owner",
        email: "ana@test",
        role: "owner",
        canPublish: true,
      }),
      member({
        userId: "v-1",
        displayName: "Val Viewer",
        email: "val@test",
        role: "viewer",
      }),
    ])
    // Neither an owner nor a viewer gets a switch: the pill says why.
    expect(screen.getByText("View only")).toBeInTheDocument()
    expect(screen.getByText("Can publish")).toBeInTheDocument()
    expect(screen.queryByRole("switch")).not.toBeInTheDocument()
  })

  it("says per-listing publishing is set from Client access", () => {
    renderTable("owner", "owner-1", [
      member({
        userId: "owner-1",
        displayName: "Ana Owner",
        email: "ana@test",
        role: "owner",
        canPublish: true,
      }),
      member({
        userId: "m-2",
        displayName: "Cat Member",
        email: "cat@test",
        locations: [{ locationId: "l1", canPublish: true, clientId: "c1" }],
      }),
    ])
    expect(screen.queryByRole("switch")).not.toBeInTheDocument()
    expect(
      screen.getByText("Set per client, from Client access.")
    ).toBeInTheDocument()
  })

  it("autosaves the publishing switch and says so beside it", async () => {
    const user = userEvent.setup()
    const update = vi
      .spyOn(membersApi, "updateMember")
      .mockResolvedValue(undefined as never)
    renderTable("owner", "owner-1", [
      member({
        userId: "owner-1",
        displayName: "Ana Owner",
        email: "ana@test",
        role: "owner",
        canPublish: true,
      }),
      member({ userId: "m-1", displayName: "Ben Member", email: "ben@test" }),
    ])
    const toggle = screen.getByRole("switch", {
      name: "Allow Ben Member to publish",
    })
    expect(toggle).not.toBeChecked()
    await user.click(toggle)
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        userId: "m-1",
        role: "member",
        canPublish: true,
      })
    )
    expect(await screen.findByText("Saved: publishing on")).toBeInTheDocument()
    expect(toggle).toHaveAccessibleDescription("Saved: publishing on")
  })

  it("shows a refused publishing change next to the switch, not in a toast", async () => {
    const user = userEvent.setup()
    vi.spyOn(membersApi, "updateMember").mockRejectedValue(new Error("boom"))
    renderTable("owner", "owner-1", [
      member({
        userId: "owner-1",
        displayName: "Ana Owner",
        email: "ana@test",
        role: "owner",
        canPublish: true,
      }),
      member({ userId: "m-1", displayName: "Ben Member", email: "ben@test" }),
    ])
    await user.click(
      screen.getByRole("switch", { name: "Allow Ben Member to publish" })
    )
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent(/^Publishing wasn’t changed\./)
    const row = screen
      .getByRole("switch", { name: "Allow Ben Member to publish" })
      .closest("tr")!
    expect(within(row).getByRole("alert")).toBe(alert)
  })

  it("lays a member out as a record card with the menu in the title line, not pinned over it", () => {
    renderTable("owner", "owner-1", [
      member({
        userId: "owner-1",
        displayName: "Ana Owner",
        email: "ana@test",
        role: "owner",
        canPublish: true,
      }),
    ])
    const row = screen.getByText("Ana Owner").closest("tr")!
    const cell = (label: string) =>
      row.querySelector(`td[data-label="${label}"]`)!
    // Title line: the member, the role badge, then the menu
    // (components/ui/table.tsx record-card priorities).
    expect(cell("Member")).toHaveAttribute("data-priority", "primary")
    expect(cell("Role")).toHaveAttribute("data-priority", "trailing")
    expect(cell("Joined")).toHaveAttribute("data-priority", "meta")
    const actions = within(row)
      .getByRole("button", { name: "Actions for Ana Owner" })
      .closest("td")!
    expect(actions).toHaveAttribute("data-priority", "actions")
    // In the flow of the title line: no hand-pinned corner position.
    expect(actions.className).not.toMatch(/absolute/)
    expect(row.className).not.toMatch(/relative/)
    // Access and publishing each take the card's whole width.
    expect(cell("Client access")).toHaveAttribute("data-span")
    expect(cell("Publishing")).toHaveAttribute("data-span")
    expect(cell("Client access")).not.toHaveAttribute("data-priority")
    expect(cell("Publishing")).not.toHaveAttribute("data-priority")
  })

  it("shows a load failure with Try again", async () => {
    const user = userEvent.setup()
    const refetch = vi.fn()
    useMembersMock.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("x"),
      refetch,
    })
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <MembersTable actorRole="owner" actorUserId="owner-1" />
      </QueryClientProvider>
    )
    expect(screen.getByText("We couldn’t load your team")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(refetch).toHaveBeenCalled()
  })

  it("summarises access by client instead of 'No listings assigned yet'", () => {
    renderTable(
      "owner",
      "owner-1",
      [
        member({
          userId: "owner-1",
          displayName: "Ana Owner",
          email: "ana@test",
          role: "owner",
          canPublish: true,
        }),
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
    expect(
      screen.queryByText("No listings assigned yet")
    ).not.toBeInTheDocument()
    expect(
      screen.getByText("Including clients added later")
    ).toBeInTheDocument()
    expect(screen.getByText("Old Crown (3 of 5 listings)")).toBeInTheDocument()
  })

  it("offers Client access for members but not for owners or admins", async () => {
    const user = userEvent.setup()
    renderTable("owner", "owner-1", [
      member({
        userId: "owner-1",
        displayName: "Ana Owner",
        email: "ana@test",
        role: "owner",
        canPublish: true,
      }),
      member({ userId: "m-1", displayName: "Ben Member", email: "ben@test" }),
    ])
    await user.click(
      screen.getByRole("button", { name: "Actions for Ana Owner" })
    )
    const ownerItem = await screen.findByRole("menuitem", {
      name: /Client access/,
    })
    expect(ownerItem).toHaveAttribute("aria-disabled", "true")
    expect(ownerItem).toHaveAccessibleDescription(
      "Owners and admins always see every client."
    )
    await user.keyboard("{Escape}")
    await user.click(
      screen.getByRole("button", { name: "Actions for Ben Member" })
    )
    const memberItem = await screen.findByRole("menuitem", {
      name: /Client access/,
    })
    expect(memberItem).not.toHaveAttribute("aria-disabled", "true")
  })
})
