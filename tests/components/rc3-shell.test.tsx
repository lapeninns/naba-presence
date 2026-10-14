import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/notifications",
  useSearchParams: () => new URLSearchParams(),
}))

import { NotificationsView } from "@/components/notifications/notifications-view"

function stub(response: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response())
  )
}
const renderView = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <NotificationsView />
    </QueryClientProvider>
  )

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// RC3 #7: a failed load shows no count, never "0 open and unread".
describe("NotificationsView error state", () => {
  it("hides the count and the mark-read action when the list fails", async () => {
    stub(
      () =>
        new Response(JSON.stringify({ error: "server_error" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        })
    )
    renderView()
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Notifications could not be loaded"
    )
    expect(screen.queryByText(/open and unread/)).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Mark shown as read" })
    ).toBeNull()
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible()
  })

  it("still states a real zero once the list has loaded", async () => {
    stub(
      () =>
        new Response(
          JSON.stringify({ items: [], unreadCount: 0, nextCursor: null }),
          { headers: { "content-type": "application/json" } }
        )
    )
    renderView()
    expect(await screen.findByText("0 open and unread")).toHaveAttribute(
      "role",
      "status"
    )
  })
})
