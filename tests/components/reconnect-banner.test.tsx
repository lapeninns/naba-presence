import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const pathname = vi.hoisted(() => ({ current: "/inbox" }))
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }))

const mutate = vi.fn()
vi.mock("@/lib/queries/use-connection-workspace", () => ({
  useConnectionsQuery: () => ({
    data: {
      connections: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          googleEmail: "old@lapen.test",
          status: "active",
          reconnectRequired: true,
          reconnectReason: null,
        },
      ],
    },
  }),
  useStartGoogleConnect: () => ({
    mutate,
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
  useConnectionWorkspace: () => ({ connect: { mutate, isPending: false } }),
}))
vi.mock("@/lib/queries/use-clients", () => ({
  useClients: () => ({ data: { items: [] } }),
}))
const role = vi.hoisted(() => ({ current: "owner" as string | null }))
vi.mock("@/lib/queries/use-session", () => ({
  useSessionRole: () => role.current,
}))

import { ReconnectBanner } from "@/components/app-shell/reconnect-banner"

function renderBanner() {
  const client = new QueryClient()
  return render(
    <QueryClientProvider client={client}>
      <ReconnectBanner />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  pathname.current = "/inbox"
  role.current = "owner"
  window.sessionStorage.clear()
  mutate.mockReset()
})

describe("ReconnectBanner", () => {
  it("explains before reconnecting, then returns to this page", async () => {
    const user = userEvent.setup()
    renderBanner()
    await user.click(screen.getByRole("button", { name: /^Reconnect/ }))
    expect(mutate).not.toHaveBeenCalled()
    await user.click(
      await screen.findByRole("button", { name: "Continue to Google" })
    )
    expect(mutate).toHaveBeenCalledWith({
      reconnectConnectionId: "11111111-1111-4111-8111-111111111111",
      returnTo: "/",
    })
  })

  it("stays off the Google connections page, which has its own Reconnect", () => {
    pathname.current = "/settings/connections"
    renderBanner()
    expect(
      screen.queryByText(/Google stopped accepting/)
    ).not.toBeInTheDocument()
  })

  it("can be hidden for the session", async () => {
    const user = userEvent.setup()
    renderBanner()
    await user.click(
      screen.getByRole("button", { name: "Hide until next session" })
    )
    await waitFor(() =>
      expect(
        screen.queryByText(/Google stopped accepting/)
      ).not.toBeInTheDocument()
    )
  })

  it("tells a member who can fix it, with no reconnect control", () => {
    role.current = "member"
    renderBanner()
    expect(
      screen.getByText(/Ask an owner or admin to reconnect it/)
    ).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Reconnect/ })).toBeNull()
  })
})
