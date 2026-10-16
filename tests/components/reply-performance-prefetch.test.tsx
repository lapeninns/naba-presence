import {
  hashKey,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import { render, waitFor } from "@testing-library/react"
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

  it("resolves the windows from the browser's clock once the server's now is old (a page restored on Back)", async () => {
    stubFetch()
    vi.useFakeTimers({
      now: new Date("2026-10-17T00:00:00.000Z"),
      toFake: ["Date"],
    })
    const fresh = replyReportPrefetch({
      rangeId: "28d",
      now: new Date(SERVER_NOW),
    })({ organisationId: "org-1" } as unknown as Session)
    const client = mountTab({ windowNow: SERVER_NOW })
    // Two hours old: dropped, so the keys are those of "now".
    await waitFor(() => {
      const keys = tabKeys(client)
      expect(keys.some((key) => key.includes("2026-10-17T00:00:00.000Z"))).toBe(
        true
      )
    })
    // ...and they are not the ones the server stored. A page mounted this
    // late (not hydrating) reads the clock at once, so only the new pair is
    // asked for.
    expect(tabKeys(client)).toHaveLength(2)
    expect(tabKeys(client)).not.toContain(hashKey(fresh[0].queryKey))
  })
})
