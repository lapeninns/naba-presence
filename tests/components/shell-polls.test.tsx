import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AppShell } from "@/components/app-shell/app-shell"
import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { Toaster } from "@/components/ui/toast"
import { REVIEW_QUEUES } from "@/lib/contracts/reviews"
import { QueryProvider } from "@/lib/queries/provider"
import { useConnectionHealth } from "@/lib/queries/use-connection-health"
import { SHELL_POLL_MS } from "@/lib/queries/use-shell-status"

/**
 * R2-X1 multiplier M4 / W5-07: an idle, visible shell used to poll four keys
 * (clients, connections, the needs-reply count, the notifications badge)
 * once a minute each — 40 requests in 10 minutes, each one a session write.
 * The shell now polls one endpoint and the clients list slowly, and nothing
 * polls while the tab is hidden.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const session = {
  sessionId: "s",
  userId: "u",
  organisationId: "o",
  organisationName: "Lapen Inns Agency",
  workspaceMode: "agency" as const,
  displayName: "Aman Shrestha",
  email: "a@example.test",
  role: "owner" as const,
  canPublish: true,
}

const counts = {
  total: 4,
  byStatus: { new: 4 },
  byQueue: Object.fromEntries(
    REVIEW_QUEUES.map((queue) => [queue, queue === "needs_reply" ? 4 : 0])
  ),
}
const connections = [
  {
    id: "g1",
    googleEmail: "operator@example.test",
    status: "active",
    notificationsEnabled: false,
    lastRefreshAt: null,
    lastErrorCode: null,
    reconnectRequired: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
]
const notifications = { items: [], nextCursor: null, unreadCount: 2 }

function stubApi() {
  const requests: string[] = []
  const status = { connections }
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input), "http://localhost")
    requests.push(url.pathname)
    const body =
      url.pathname === "/api/shell-status"
        ? { counts, connections: status.connections, notifications }
        : url.pathname === "/api/reviews/counts"
          ? counts
          : url.pathname === "/api/google/connections"
            ? { connections: status.connections }
            : url.pathname === "/api/notifications"
              ? notifications
              : url.pathname === "/api/clients"
                ? { items: [], unassignedLocationCount: 0 }
                : url.pathname === "/api/organisations"
                  ? { items: [] }
                  : url.pathname === "/api/session"
                    ? { session }
                    : {}
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  })
  vi.stubGlobal("fetch", fetchMock)
  return { requests, status }
}

/** What the inbox mounts beside the shell: the connection health line. */
function InboxPage() {
  const health = useConnectionHealth()
  return (
    <PageFrame>
      <PageHeader title="Inbox" description={health.label} />
    </PageFrame>
  )
}

function renderShell() {
  return render(
    <Toaster>
      <QueryProvider>
        <AppShell session={session}>
          <InboxPage />
        </AppShell>
      </QueryProvider>
    </Toaster>
  )
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  })
  document.dispatchEvent(new Event("visibilitychange", { bubbles: true }))
}

const minutes = (count: number) => count * 60_000

async function idle(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  })
})

afterEach(() => {
  setVisibility("visible")
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("the shell's polling", () => {
  it("makes at most 10 requests in 10 idle minutes on a visible tab", async () => {
    const api = stubApi()
    renderShell()
    // Mount: every reader's first load.
    await idle(1_000)
    api.requests.length = 0

    await idle(minutes(10))
    const tally = api.requests.reduce<Record<string, number>>((all, path) => {
      all[path] = (all[path] ?? 0) + 1
      return all
    }, {})
    expect(api.requests.length).toBeLessThanOrEqual(10)
    // One request per tick refreshes the badges and the connections.
    expect(tally["/api/shell-status"]).toBe(
      Math.floor(minutes(10) / SHELL_POLL_MS)
    )
    expect(tally["/api/reviews/counts"]).toBeUndefined()
    expect(tally["/api/notifications"]).toBeUndefined()
    expect(tally["/api/google/connections"]).toBeUndefined()
    expect(tally["/api/clients"]).toBe(2)
  })

  it("polls nothing while the tab is hidden, and catches up once on return", async () => {
    const api = stubApi()
    renderShell()
    await idle(1_000)
    api.requests.length = 0

    setVisibility("hidden")
    await idle(minutes(10))
    expect(api.requests).toEqual([])

    setVisibility("visible")
    await idle(1_000)
    expect(api.requests.filter((p) => p === "/api/shell-status")).toHaveLength(
      1
    )
    // The seeded readers wait for the shell's read instead of each refetching.
    expect(api.requests).not.toContain("/api/reviews/counts")
    expect(api.requests).not.toContain("/api/notifications")
    expect(api.requests).not.toContain("/api/google/connections")
  })

  it("refreshes the clients list at once when a connection changes", async () => {
    const api = stubApi()
    renderShell()
    await idle(1_000)
    api.requests.length = 0

    api.status.connections = [
      { ...connections[0], status: "revoked", reconnectRequired: true },
    ]
    await idle(SHELL_POLL_MS)
    expect(api.requests).toContain("/api/shell-status")
    expect(api.requests).toContain("/api/clients")
  })
})
