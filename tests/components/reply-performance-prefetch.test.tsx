import {
  hashKey,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import { act, cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/server/db", () => ({ withTenant: vi.fn() }))
vi.mock("@/lib/server/analytics-overview", () => ({
  loadAnalyticsOverview: vi.fn(),
}))
vi.mock("@/lib/server/prefetch", () => ({
  throughWire: (_schema: unknown, payload: unknown) => payload,
}))

import { ReplyPerformanceTab } from "@/components/performance/reply-performance-tab"
import { replyReportPrefetch } from "@/lib/server/reports-prefetch"
import type { Session } from "@/lib/server/session"

const CLIENT_ID = "6f1c3a52-2f1c-4c46-9a56-6c0b8f5b2f10"
const SERVER_NOW = "2026-10-16T22:00:00.000Z"

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 500 }))
  )
}

function mountTab(props: { windowNow?: string; clientId?: string }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ReplyPerformanceTab {...props} />
    </QueryClientProvider>
  )
  return client
}

const tabKeys = (client: QueryClient) =>
  client
    .getQueryCache()
    .getAll()
    .map((query) => query.queryHash)
    .filter((hash) => hash.startsWith('["analytics","overview"'))
    .sort()

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// The page stores the two overview windows under keys that carry from/to to
// the millisecond; the tab asks for them under its own. If they ever differ
// the prefetch silently becomes a loading state again, and a hydrated page
// would render loading where the server rendered figures (#418).
describe("the reply report's server prefetch and the tab", () => {
  for (const clientId of [undefined, CLIENT_ID]) {
    it(`store and read the same two keys (${clientId ? "one client" : "all clients"})`, async () => {
      stubFetch()
      // The server's now is moments old, as it is at hydration.
      vi.useFakeTimers({
        now: new Date("2026-10-16T22:00:05.000Z"),
        toFake: ["Date"],
      })
      const entries = replyReportPrefetch({
        rangeId: "28d",
        clientId,
        now: new Date(SERVER_NOW),
      })({ organisationId: "org-1" } as unknown as Session)
      const client = mountTab({ windowNow: SERVER_NOW, clientId })
      await waitFor(() => expect(tabKeys(client)).toHaveLength(2))
      expect(tabKeys(client)).toEqual(
        entries.map((entry) => hashKey(entry.queryKey)).sort()
      )
    })
  }

  // Staleness is decided when the tab mounts, from this browser's own clock:
  // how long ago this page first saw that `now`. An open report is never
  // reloaded under the reader, and a device clock minutes out from the
  // server's changes nothing.
  //
  // These two tests run the real thing: `setInterval` is faked as well as
  // `Date`, so the shared 15 s clock ticks inside `act` as it does in a
  // browser, and the re-render is a NEW element (the same element object is
  // skipped by React and proves nothing). Against the previous component,
  // which subscribed to that clock, both fail with four asked-for windows.
  function tree(client: QueryClient, windowNow: string) {
    return (
      <QueryClientProvider client={client}>
        <ReplyPerformanceTab windowNow={windowNow} />
      </QueryClientProvider>
    )
  }

  it("does not reload an open report when the clock ticks past ten minutes", async () => {
    stubFetch()
    const opened = "2026-10-16T09:00:00.000Z"
    vi.useFakeTimers({
      now: new Date(opened),
      toFake: ["Date", "setInterval", "clearInterval"],
    })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const view = render(tree(client, opened))
    await waitFor(() => expect(tabKeys(client)).toHaveLength(2))
    const before = tabKeys(client)
    // Twenty-five minutes of 15 s ticks, with the report open the whole time.
    act(() => {
      vi.advanceTimersByTime(25 * 60_000)
    })
    view.rerender(tree(client, opened))
    expect(tabKeys(client)).toEqual(before)
    // The figures are still on screen, not the loading state.
    expect(view.container.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it("keeps the prefetched keys when the device clock is hours ahead of the server's now", async () => {
    stubFetch()
    const serverNow = "2026-10-16T12:00:00.000Z"
    // The device says it is two hours later than the server's render.
    vi.useFakeTimers({
      now: new Date("2026-10-16T14:00:00.000Z"),
      toFake: ["Date", "setInterval", "clearInterval"],
    })
    const entries = replyReportPrefetch({
      rangeId: "28d",
      now: new Date(serverNow),
    })({ organisationId: "org-1" } as unknown as Session)
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const view = render(tree(client, serverNow))
    await waitFor(() => expect(tabKeys(client)).toHaveLength(2))
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    view.rerender(tree(client, serverNow))
    expect(tabKeys(client)).toEqual(
      entries.map((entry) => hashKey(entry.queryKey)).sort()
    )
  })

  it("resolves the windows from the browser's clock for a page restored long after it first saw the server's now (Back)", async () => {
    stubFetch()
    const restored = "2026-10-16T10:00:00.000Z"
    vi.useFakeTimers({ now: new Date(restored), toFake: ["Date"] })
    const first = mountTab({ windowNow: restored })
    await waitFor(() => expect(tabKeys(first)).toHaveLength(2))
    cleanup()
    // The page comes back from the router cache with the same payload.
    vi.setSystemTime(new Date("2026-10-16T11:30:00.000Z"))
    const second = mountTab({ windowNow: restored })
    await waitFor(() => expect(tabKeys(second)).toHaveLength(2))
    expect(
      tabKeys(second).some((key) => key.includes("2026-10-16T11:30:00.000Z"))
    ).toBe(true)
    expect(tabKeys(second)).not.toEqual(tabKeys(first))
  })
})
