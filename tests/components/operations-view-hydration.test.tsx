import {
  type DehydratedState,
  dehydrate,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import { act } from "@testing-library/react"
import type { ReactElement } from "react"
import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { OperationsView } from "@/components/settings/operations-view"
import { Toaster } from "@/components/ui/toast"
import {
  operationsHealthSchema,
  schedulerTickSchema,
} from "@/lib/contracts/operations"
import { queryKeys } from "@/lib/queries/keys"
import { HydrationBoundary } from "@/lib/queries/hydration-boundary"

// SET-22 put Operations in the first HTML. Whether a scheduled job is
// "Overdue" is decided during render, so the server and the hydrating
// browser must judge it by the same clock, or a device clock a few minutes
// fast turns "On schedule" into "Overdue" mid-hydration (React #418).

vi.mock("@/lib/api/operations", () => ({
  fetchOperationsHealth: vi.fn(() => new Promise(() => {})),
  fetchWebhookFailures: vi.fn(() => new Promise(() => {})),
  replayWebhookEvent: vi.fn(),
  retryNotificationDeliveries: vi.fn(),
}))
vi.mock("@/lib/api/settings", () => ({
  fetchSettings: vi.fn(() => new Promise(() => {})),
}))

const SERVER_NOW = Date.parse("2026-10-16T12:00:00.000Z")

/** The jobs tick (stale after 300 s) completed 4 minutes before the server rendered. */
function health() {
  return operationsHealthSchema.parse({
    generatedAt: new Date(SERVER_NOW).toISOString(),
    sync: {},
    webhooks: {},
    connections: [],
    publish24h: [],
    replyRejections30d: [],
    providerTotalDivergence30d: 0,
    failedWebhookEvents: 0,
    deadWebhookEvents: 0,
    oldestFailedEventAgeSeconds: null,
    ambiguousPublishAttempts: 0,
    staleStartedAttempts: 0,
    dueJobBacklog: 0,
    checkpointFailures24h: 0,
    connectionErrors24h: 0,
    schedulerHeartbeatAt: new Date(SERVER_NOW - 60_000).toISOString(),
    schedulerTicks: [
      schedulerTickSchema.parse({
        name: "jobs",
        lastCompletedAt: new Date(SERVER_NOW - 4 * 60_000).toISOString(),
        staleAfterSeconds: 300,
        stale: false,
        paused: false,
      }),
    ],
  })
}

function client() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  })
}

function page(state: DehydratedState): ReactElement {
  return (
    <QueryClientProvider client={client()}>
      <Toaster>
        <HydrationBoundary state={state}>
          <OperationsView />
        </HydrationBoundary>
      </Toaster>
    </QueryClientProvider>
  )
}

/** Server-render at SERVER_NOW, then hydrate with the browser `skewMs` ahead. */
async function hydrateWithSkew(skewMs: number) {
  vi.setSystemTime(SERVER_NOW)
  const server = client()
  server.setQueryData(queryKeys.operationsHealth, health())
  server.setQueryData(queryKeys.webhookFailures, { items: [] })
  const state = dehydrate(server)
  const html = renderToString(page(state))
  const container = document.createElement("div")
  container.innerHTML = html
  document.body.appendChild(container)

  vi.setSystemTime(SERVER_NOW + skewMs)
  const received = JSON.parse(JSON.stringify(state)) as DehydratedState
  const errors: unknown[] = []
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
  let root: ReturnType<typeof hydrateRoot> | undefined
  await act(async () => {
    root = hydrateRoot(container, page(received), {
      onRecoverableError: (error) => errors.push(error),
    })
  })
  const hydrationErrors = [
    ...errors.map(String),
    ...consoleError.mock.calls
      .map((call) => call.map(String).join(" "))
      .filter((line) => /hydrat|didn't match/i.test(line)),
  ]
  consoleError.mockRestore()
  const text = container.textContent ?? ""
  act(() => root!.unmount())
  container.remove()
  return { serverText: html, hydrationErrors, text }
}

describe("OperationsView hydration (SET-22)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("paints the prefetched figures in the server HTML", async () => {
    const { serverText } = await hydrateWithSkew(0)
    expect(serverText).toContain("Running")
    expect(serverText).not.toContain("Loading operations health")
  })

  it("judges Overdue by the server's clock while hydrating, with the device 2 minutes fast", async () => {
    const { serverText, hydrationErrors } = await hydrateWithSkew(2 * 60_000)
    expect(serverText).toContain("On schedule")
    expect(serverText).not.toContain("Overdue")
    expect(hydrationErrors).toEqual([])
  })
})
