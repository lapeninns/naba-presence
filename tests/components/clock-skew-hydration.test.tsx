import {
  type DehydratedState,
  dehydrate,
  HydrationBoundary as TanStackHydrationBoundary,
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query"
import { act } from "@testing-library/react"
import type { ReactElement } from "react"
import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { comparisonCheck } from "@/lib/listings/health"
import {
  alignToClientClock,
  HydrationBoundary,
} from "@/lib/queries/hydration-boundary"
import { useNow } from "@/lib/time/server-now"

// GF-7: with the device clock a minute or more ahead of the server, the
// inbox hydrated with React #418. The server-prefetched query was already
// past staleTime by the browser's clock, so TanStack's first (optimistic)
// result said "fetching" and the list rendered busy where the server had
// rendered it idle. An hour ahead, the listing's "checked within the hour"
// threshold flipped its wording the same way.

const SERVER_NOW = Date.parse("2026-10-13T12:00:00.000Z")
const KEY = ["reviews"]

function client() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  })
}

/** What the inbox list does: data, and a busy mark while refreshing. */
function ReviewsProbe() {
  const query = useQuery({
    queryKey: KEY,
    queryFn: () => new Promise<string>(() => {}),
  })
  return (
    <p aria-busy={query.isFetching || undefined}>
      {query.data}
      {query.isFetching ? " (refreshing)" : ""}
    </p>
  )
}

/** What the listing's area card does: an hour-old check is overdue. */
function ComparisonProbe({ observedAt }: { observedAt: string }) {
  const now = useNow()
  const check = comparisonCheck(
    { status: "in_sync", observedAt, checkStatus: "checked" } as never,
    now
  )
  return (
    <p>{check === "checked" ? "Checked against Google" : "Check overdue"}</p>
  )
}

/**
 * Server-render `page` with the clock at SERVER_NOW, then hydrate it in a
 * "browser" whose clock is `skewMs` ahead. Returns the hydration errors.
 */
async function hydrateWithSkew(
  page: (state: DehydratedState) => ReactElement,
  skewMs: number
) {
  vi.setSystemTime(SERVER_NOW)
  const server = client()
  server.setQueryData(KEY, "3 reviews")
  const state = dehydrate(server)
  const html = renderToString(
    <QueryClientProvider client={client()}>{page(state)}</QueryClientProvider>
  )
  const container = document.createElement("div")
  container.innerHTML = html
  document.body.appendChild(container)

  vi.setSystemTime(SERVER_NOW + skewMs)
  // The browser gets its own copy, deserialised from the flight payload: the
  // boundary aligns each payload object once per page load.
  const received = JSON.parse(JSON.stringify(state)) as DehydratedState
  const errors: unknown[] = []
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
  let root: ReturnType<typeof hydrateRoot> | undefined
  await act(async () => {
    root = hydrateRoot(
      container,
      <QueryClientProvider client={client()}>
        {page(received)}
      </QueryClientProvider>,
      { onRecoverableError: (error) => errors.push(error) }
    )
  })
  const hydrationErrors = [
    ...errors.map(String),
    ...consoleError.mock.calls
      .map((call) => call.map(String).join(" "))
      .filter((line) => /hydrat|didn't match/i.test(line)),
  ]
  consoleError.mockRestore()
  const text = container.textContent
  act(() => root!.unmount())
  container.remove()
  return { serverText: html, hydrationErrors, text }
}

describe("hydration under device clock skew (GF-7)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  for (const skewMs of [61_000, 300_000, 3_600_000]) {
    it(`a prefetched query hydrates as idle with the browser ${skewMs / 1000}s ahead`, async () => {
      const { hydrationErrors, text } = await hydrateWithSkew(
        (state) => (
          <HydrationBoundary state={state}>
            <ReviewsProbe />
          </HydrationBoundary>
        ),
        skewMs
      )
      expect(hydrationErrors).toEqual([])
      expect(text).toBe("3 reviews")
    })
  }

  // The negative control: TanStack's own boundary, the same skew. This is
  // the defect, so the test above can fail.
  it("is a real mismatch through TanStack's boundary as it stands", async () => {
    const { hydrationErrors } = await hydrateWithSkew(
      (state) => (
        <TanStackHydrationBoundary state={state}>
          <ReviewsProbe />
        </TanStackHydrationBoundary>
      ),
      61_000
    )
    expect(hydrationErrors.length).toBeGreaterThan(0)
  })

  it("decides an hour threshold by the server's clock while hydrating, then the browser's", async () => {
    // Checked 59 minutes before the server rendered: fresh there, overdue
    // by a browser clock an hour ahead.
    const observedAt = new Date(SERVER_NOW - 59 * 60_000).toISOString()
    const { serverText, hydrationErrors, text } = await hydrateWithSkew(
      (state) => (
        <HydrationBoundary state={state}>
          <ComparisonProbe observedAt={observedAt} />
        </HydrationBoundary>
      ),
      3_600_000
    )
    expect(serverText).toContain("Checked against Google")
    expect(hydrationErrors).toEqual([])
    // After hydration it is the browser's view: an hour later, overdue.
    expect(text).toBe("Check overdue")
  })

  it("a threshold read straight from Date.now() is a real mismatch (control)", async () => {
    const observedAt = new Date(SERVER_NOW - 59 * 60_000).toISOString()
    function Inline() {
      return (
        <p>
          {comparisonCheck({
            status: "in_sync",
            observedAt,
            checkStatus: "checked",
          } as never) === "checked"
            ? "Checked against Google"
            : "Check overdue"}
        </p>
      )
    }
    const { hydrationErrors } = await hydrateWithSkew(
      () => <Inline />,
      3_600_000
    )
    expect(hydrationErrors.length).toBeGreaterThan(0)
  })

  it("keeps each query exactly as old as when the server sent it", () => {
    const aligned = alignToClientClock(
      {
        queries: [
          {
            dehydratedAt: 1_000,
            state: { dataUpdatedAt: 900, errorUpdatedAt: 0 },
          },
        ],
      },
      61_000
    )
    expect(aligned.queries[0]).toMatchObject({
      dehydratedAt: 61_000,
      state: { dataUpdatedAt: 60_900, errorUpdatedAt: 0 },
    })
  })
})
