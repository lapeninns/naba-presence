import {
  type DehydratedState,
  dehydrate,
  HydrationBoundary as TanStackHydrationBoundary,
  QueryClient,
} from "@tanstack/react-query"
import { act } from "@testing-library/react"
import type { ReactElement } from "react"
import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { HoursState } from "@/lib/api/location-hours"
import type { SessionUser } from "@/lib/contracts/session"
import { HydrationBoundary } from "@/lib/queries/hydration-boundary"
import { queryKeys } from "@/lib/queries/keys"
import { QueryProvider } from "@/lib/queries/provider"
import { sessionScopeToken } from "@/lib/queries/session-scope"
import { useHours } from "@/lib/queries/use-location-hours"
import { useSession } from "@/lib/queries/use-session"

// #195, Listings peer review note A. A listing tab's first read is streamed
// on a document load (components/listings/streamed-tab.tsx): `prefetch()`
// stamps it with the reader's scope, and the page boundary hydrates it only
// when the session the dashboard layout hydrated above it has that scope.
// This is that load end to end, server render then browser hydration: the
// stamped hours payload must land on the first render, with no
// `GET /api/locations/:id/hours`, no session refetch and no hydration error,
// including with the device clock ahead of the server (GF-7).

const fetchHoursMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api/location-hours", () => ({ fetchHours: fetchHoursMock }))
const fetchSessionMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api/session", () => ({ fetchSession: fetchSessionMock }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))

const SERVER_NOW = Date.parse("2026-10-13T12:00:00.000Z")
const LOCATION = "00000000-0000-4000-8000-0000000000aa"

const owner = {
  userId: "00000000-0000-4000-8000-000000000002",
  organisationId: "00000000-0000-4000-8000-000000000001",
  organisationName: "Org",
  workspaceMode: "business",
  displayName: "Ada",
  email: "ada@example.test",
  role: "owner",
  canPublish: true,
} as SessionUser

/** What the dashboard layout sends: the session, unstamped. */
function layoutPayload() {
  const server = new QueryClient()
  server.setQueryData(queryKeys.session, { session: owner })
  return dehydrate(server)
}

/** What `prefetch(session, hoursTabPrefetch(id))` streams with the tab. */
function hoursPayload(stampedFor: SessionUser) {
  const server = new QueryClient()
  server.setQueryData(queryKeys.locationHours(LOCATION), {
    source: "stored",
  } as HoursState)
  return { ...dehydrate(server), scope: sessionScopeToken(stampedFor) }
}

/** The shell's session read and the hours editor's, with a busy mark. */
function Probes() {
  const session = useSession()
  const hours = useHours(LOCATION)
  return (
    <>
      <p>{session.data?.session?.role ?? "no session"}</p>
      <p aria-busy={hours.isFetching || undefined}>
        {hours.data ? `hours ${hours.data.source}` : "hours loading"}
        {hours.isFetching ? " (refreshing)" : ""}
      </p>
    </>
  )
}

type Boundary = (props: {
  state: DehydratedState
  children: ReactElement
}) => ReactElement

/** The dashboard as a document load renders it: layout boundary, tab boundary. */
function page(
  layout: DehydratedState,
  tab: DehydratedState,
  Tab: Boundary = HydrationBoundary as Boundary
) {
  return (
    <QueryProvider refreshRouterOnScopeChange>
      <HydrationBoundary state={layout}>
        <Tab state={tab}>
          <Probes />
        </Tab>
      </HydrationBoundary>
    </QueryProvider>
  )
}

/**
 * Server-render with the clock at SERVER_NOW, then hydrate in a browser
 * whose clock is `skewMs` ahead, from its own copy of the flight payloads.
 */
async function documentLoad(
  stampedFor: SessionUser,
  skewMs: number,
  Tab?: Boundary
) {
  vi.setSystemTime(SERVER_NOW)
  // Both read now, by the server's clock.
  const layout = layoutPayload()
  const tab = hoursPayload(stampedFor)
  const html = renderToString(page(layout, tab, Tab))
  const container = document.createElement("div")
  container.innerHTML = html
  document.body.appendChild(container)

  vi.setSystemTime(SERVER_NOW + skewMs)
  const copy = <T,>(state: T) => JSON.parse(JSON.stringify(state)) as T
  const errors: unknown[] = []
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
  let root: ReturnType<typeof hydrateRoot> | undefined
  await act(async () => {
    root = hydrateRoot(container, page(copy(layout), copy(tab), Tab), {
      onRecoverableError: (error) => errors.push(error),
    })
  })
  await act(() => new Promise((done) => setTimeout(done, 0)))
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
  return { serverHtml: html, hydrationErrors, text }
}

describe("a stamped Listings tab payload on a document load (#195 note A)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    // A request would never answer; the assertions are that none is made.
    fetchHoursMock.mockImplementation(() => new Promise(() => {}))
    fetchSessionMock.mockImplementation(() => new Promise(() => {}))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  // 61 s puts the session past the default 30 s staleTime by an unaligned
  // clock; 6 minutes puts the hours past GOOGLE_LIVE_READ's 5 minutes.
  for (const skewMs of [0, 61_000, 360_000]) {
    it(`hydrates with the session in cache and asks for nothing, browser ${skewMs / 1000}s ahead`, async () => {
      const { serverHtml, hydrationErrors, text } = await documentLoad(
        owner,
        skewMs
      )
      // The server render already had the hours: the scope check passed there.
      expect(serverHtml).toContain("hours stored")
      expect(hydrationErrors).toEqual([])
      expect(text).toBe("ownerhours stored")
      expect(fetchHoursMock).not.toHaveBeenCalled()
      expect(fetchSessionMock).not.toHaveBeenCalled()
    })
  }

  // The controls: each shows the assertions above can fail.
  it("a payload stamped for another scope is refused, and the tab fetches (control)", async () => {
    const { serverHtml, text } = await documentLoad(
      { ...owner, role: "viewer", canPublish: false },
      0
    )
    expect(serverHtml).toContain("hours loading")
    expect(text).toContain("hours loading")
    expect(fetchHoursMock).toHaveBeenCalled()
    // The refusal asks the server who this is now.
    expect(fetchSessionMock).toHaveBeenCalled()
  })

  it("through TanStack's own boundary the same tab refetches at 6 minutes' skew (control)", async () => {
    const { hydrationErrors } = await documentLoad(
      owner,
      360_000,
      TanStackHydrationBoundary as Boundary
    )
    expect(hydrationErrors.length).toBeGreaterThan(0)
    expect(fetchHoursMock).toHaveBeenCalled()
  })
})
