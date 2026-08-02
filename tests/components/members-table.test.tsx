import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MembersTable } from "@/components/settings/members-table"
import { Toaster } from "@/components/ui/toast"
import type { Member } from "@/lib/api/members"

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

function renderTable(actorRole: Member["role"], actorUserId: string, members: Member[]) {
  useMembersMock.mockReturnValue({ data: { members }, isPending: false, isError: false, refetch: vi.fn() })
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
  it("marks the current user, disables self-removal and last-owner demotion", () => {
    renderTable("owner", "owner-1", [
      member({ userId: "owner-1", displayName: "Ana Owner", email: "ana@test", role: "owner", canPublish: true }),
      member({ userId: "m-1", displayName: "Ben Member", email: "ben@test", role: "member" }),
    ])
    expect(screen.getByText("You")).toBeInTheDocument()
    const removeAna = screen.getByRole("button", { name: "Remove Ana Owner" })
    expect(removeAna).toBeDisabled()
  })

  it("stops an admin from editing an owner row", () => {
    renderTable("admin", "admin-1", [
      member({ userId: "owner-1", displayName: "Ana Owner", email: "ana@test", role: "owner", canPublish: true }),
      member({ userId: "admin-1", displayName: "Al Admin", email: "al@test", role: "admin", canPublish: true }),
    ])
    expect(screen.getByRole("button", { name: "Remove Ana Owner" })).toBeDisabled()
  })
})
