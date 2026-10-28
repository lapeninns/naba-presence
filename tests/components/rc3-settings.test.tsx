import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MembersTable } from "@/components/settings/members-table"
import { NotificationPreferences } from "@/components/settings/notification-preferences"
import { UsageCard } from "@/components/settings/usage-card"
import { Toaster } from "@/components/ui/toast"
import type { Member } from "@/lib/api/members"
import type { AiCredits, AiCreditsDaily } from "@/lib/contracts/ai-credits"
import * as creditsHook from "@/lib/queries/use-ai-credits"

const useMembersMock = vi.fn()
vi.mock("@/lib/queries/use-members", () => ({
  useMembers: () => useMembersMock(),
}))

const withClient = (node: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {node}
    </QueryClientProvider>
  )

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// RC3 #6: a failed usage load says only that, with its retry.
describe("UsageCard error state", () => {
  it("shows the error and a retry, never the empty-data line", () => {
    const refetchCredits = vi.fn()
    const refetchDaily = vi.fn()
    vi.spyOn(creditsHook, "useAiCredits").mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch: refetchCredits,
    } as unknown as UseQueryResult<AiCredits>)
    vi.spyOn(creditsHook, "useAiCreditsDaily").mockReturnValue({
      data: {
        days: [
          { date: "2026-10-01", credits: 0 },
          { date: "2026-10-02", credits: 0 },
        ],
      },
      refetch: refetchDaily,
    } as unknown as UseQueryResult<AiCreditsDaily>)
    render(<UsageCard />)
    expect(screen.getByRole("alert")).toHaveTextContent(
      "AI reply credits could not be loaded."
    )
    expect(screen.queryByText(/No AI-written replies yet/)).toBeNull()
    expect(document.querySelector("[data-slot=usage-bars]")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(refetchCredits).toHaveBeenCalledTimes(1)
    expect(refetchDaily).toHaveBeenCalledTimes(1)
  })
})

// RC3 #17: the notification-settings error names what failed.
describe("NotificationPreferences error state", () => {
  it("uses specific copy, not the generic fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "server_error" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          })
      )
    )
    withClient(<NotificationPreferences role="owner" />)
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Notification settings could not be loaded")
    expect(alert).toHaveTextContent(
      "We couldn't load your notification settings. Try again."
    )
    expect(alert).not.toHaveTextContent("Something went wrong")
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible()
  })
})

// RC3 #8: the email truncates with its full value kept; the date is sans.
describe("MembersTable narrow table row", () => {
  it("keeps the full email in a title and sets the joined date in sans", () => {
    const email = "harness-1b5bdf13@nabapresence.test"
    const member: Member = {
      userId: "owner-1",
      email,
      displayName: "Harness user",
      role: "owner",
      canPublish: true,
      locationScope: "all",
      createdAt: "2026-10-14T09:00:00.000Z",
      locations: [],
    }
    useMembersMock.mockReturnValue({
      data: { members: [member] },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    withClient(
      <Toaster>
        <MembersTable actorRole="owner" actorUserId="owner-1" />
      </Toaster>
    )
    const emailNode = screen.getByText(email)
    expect(emailNode).toHaveAttribute("title", email)
    expect(emailNode).toHaveClass("truncate")
    expect(emailNode.className).not.toMatch(/overflow-wrap/)
    const joined = document.querySelector("[data-slot=member-joined]")
    expect(joined).not.toBeNull()
    expect(joined).toHaveClass("tabular-nums")
    expect(joined?.className).not.toMatch(/font-mono/)
  })
})
