import {
  type DehydratedState,
  dehydrate,
  QueryClient,
  QueryClientProvider,
  type QueryKey,
  useQuery,
} from "@tanstack/react-query"
import { act, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SessionUser } from "@/lib/contracts/session"
import {
  HydrationBoundary,
  inLiveScope,
} from "@/lib/queries/hydration-boundary"
import { queryKeys } from "@/lib/queries/keys"
import { QueryProvider } from "@/lib/queries/provider"
import { resetScopedQueries } from "@/lib/queries/scope-reset"
import { sessionScopeToken } from "@/lib/queries/session-scope"
import { useInvitations } from "@/lib/queries/use-invitations"
import { useMembers } from "@/lib/queries/use-members"
import { useSession } from "@/lib/queries/use-session"

// #195 security review (P1): /team is server-rendered with the members and
// the pending invitations (their invite links included) for owners and
// admins. Next can mount an old page payload again without running the page
// (Back restores it from the router cache). After a downgrade to viewer,
// useScopeReset empties the cache, and Back then put the admin's payload
// back, fresh, with no request to check the role. Every prefetched payload
// now carries the scope it was read under, and the boundary hydrates it only
// into a cache whose session has that scope.

const fetchMembersMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api/members", () => ({ fetchMembers: fetchMembersMock }))
const fetchInvitationsMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api/invitations", () => ({
  fetchInvitations: fetchInvitationsMock,
}))

const fetchSessionMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api/session", () => ({ fetchSession: fetchSessionMock }))
const refresh = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}))

const INVITE_URL = "https://app.example.test/invite/secret-token"

function session(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    userId: "00000000-0000-4000-8000-000000000002",
    organisationId: "00000000-0000-4000-8000-000000000001",
    organisationName: "Org",
    workspaceMode: "agency",
    displayName: "Ada",
    email: "ada@example.test",
    role: "admin",
    canPublish: true,
    ...overrides,
  } as SessionUser
}
const admin = session()
const viewer = session({ role: "viewer", canPublish: false })

/** What `prefetch(session, teamPrefetch())` sends with the page. */
function teamPayload(readFor: SessionUser) {
  const server = new QueryClient()
  server.setQueryData(queryKeys.members, {
    members: [{ userId: readFor.userId, email: "ben@example.test" }],
  })
  server.setQueryData(queryKeys.invitations, {
    invitations: [
      { id: "inv-1", email: "new@example.test", inviteUrl: INVITE_URL },
    ],
  })
  return { ...dehydrate(server), scope: sessionScopeToken(readFor) }
}

function TeamProbe() {
  const members = useMembers()
  const invitations = useInvitations()
  const list = invitations.data as
    { invitations: { inviteUrl?: string }[] } | undefined
  return (
    <>
      <p data-testid="members">
        {members.data
          ? "members shown"
          : members.isError
            ? "refused"
            : "loading"}
      </p>
      <p data-testid="invite">{list?.invitations[0]?.inviteUrl ?? "none"}</p>
    </>
  )
}

function mount(client: QueryClient) {
  const page = (state: DehydratedState | null) => (
    <QueryClientProvider client={client}>
      {state ? (
        <HydrationBoundary state={state}>
          <TeamProbe />
        </HydrationBoundary>
      ) : (
        <p>Inbox</p>
      )}
    </QueryClientProvider>
  )
  const view = render(page(null))
  return {
    show: async (state: DehydratedState | null) => {
      await act(async () => view.rerender(page(state)))
      await act(() => new Promise((done) => setTimeout(done, 0)))
    },
  }
}

function signedIn(as: SessionUser) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  })
  // The dashboard layout hydrates the session before any page boundary.
  client.setQueryData(queryKeys.session, { session: as })
  return client
}

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

/** What the dashboard layout sends: the session, unstamped. */
function layoutPayload(readFor: SessionUser) {
  const server = new QueryClient()
  server.setQueryData(queryKeys.session, { session: readFor })
  return dehydrate(server)
}

/**
 * The shell, which reads the session (app-shell.tsx). Its button stands in
 * for the shell's own session refetches (polls, focus, access lost).
 */
function ShellProbe() {
  const { data, refetch } = useSession()
  return (
    <>
      <p data-testid="role">{data?.session?.role ?? "none"}</p>
      <button type="button" onClick={() => void refetch()}>
        Check session
      </button>
    </>
  )
}

/**
 * The dashboard as Next mounts it: the provider (one cache per visit to the
 * dashboard), the layout's boundary, the page's boundary.
 */
function dashboard(layout: DehydratedState, team: DehydratedState) {
  return (
    <QueryProvider refreshRouterOnScopeChange>
      <HydrationBoundary state={layout}>
        <ShellProbe />
        <HydrationBoundary state={team}>
          <TeamProbe />
        </HydrationBoundary>
      </HydrationBoundary>
    </QueryProvider>
  )
}

describe("Back and Forward after a downgrade, through the real provider (#195)", () => {
  const refused = Object.assign(new Error("Forbidden"), { status: 403 })

  it("refreshes the router as soon as the tab learns of it, and refuses the old Team payload", async () => {
    fetchSessionMock.mockResolvedValue({ session: admin })
    fetchMembersMock.mockRejectedValue(refused)
    fetchInvitationsMock.mockRejectedValue(refused)
    const layout = layoutPayload(admin)
    const team = teamPayload(admin)
    const view = render(dashboard(layout, team))
    expect(screen.getByTestId("invite")).toHaveTextContent(INVITE_URL)

    // The shell's next session read says viewer.
    fetchSessionMock.mockResolvedValue({ session: viewer })
    await act(async () =>
      screen.getByRole("button", { name: "Check session" }).click()
    )
    // The cache resets and the router is refreshed: Next drops every page
    // payload it kept for Back and Forward.
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.getByTestId("role")).toHaveTextContent("viewer")
    )
    expect(screen.getByTestId("invite")).toHaveTextContent("none")

    // And if Next did mount the old payload again, it is refused.
    view.rerender(dashboard(layout, { ...team }))
    await act(() => new Promise((done) => setTimeout(done, 0)))
    expect(screen.queryByText(INVITE_URL)).not.toBeInTheDocument()
  })

  it("asks the server again when Forward brings back a visit the tab never saw downgraded", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(Date.now())
    fetchSessionMock.mockResolvedValue({ session: admin })
    const layout = layoutPayload(admin)
    const team = teamPayload(admin)
    const first = render(dashboard(layout, team))
    expect(screen.getByTestId("invite")).toHaveTextContent(INVITE_URL)
    expect(fetchSessionMock).not.toHaveBeenCalled()

    // Leaves the dashboard by a soft link (/privacy), so its cache goes.
    first.unmount()
    // Meanwhile the account is made a viewer; this tab hears nothing.
    fetchSessionMock.mockResolvedValue({ session: viewer })
    fetchMembersMock.mockRejectedValue(refused)
    fetchInvitationsMock.mockRejectedValue(refused)
    vi.setSystemTime(Date.now() + 60_000)

    // Forward: Next mounts the same layout and Team payloads again, into a
    // new cache. They keep the age they had, so nothing passes as fresh.
    render(dashboard(layout, team))
    await waitFor(() => expect(fetchSessionMock).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.getByTestId("role")).toHaveTextContent("viewer")
    )
    await waitFor(() =>
      expect(screen.getByTestId("invite")).toHaveTextContent("none")
    )
    expect(fetchMembersMock).toHaveBeenCalled()
    expect(refresh).toHaveBeenCalled()
  })
})

describe("a prefetched payload only reaches the scope it was read for (#195)", () => {
  it("doesn't put an admin's Team payload back after a downgrade and Back", async () => {
    const refused = Object.assign(new Error("Forbidden"), { status: 403 })
    fetchMembersMock.mockRejectedValue(refused)
    fetchInvitationsMock.mockRejectedValue(refused)
    const client = signedIn(admin)
    const page = mount(client)

    // An admin opens Team: the rows come with the page, no request.
    const payload = teamPayload(admin)
    await page.show(payload)
    expect(screen.getByTestId("invite")).toHaveTextContent(INVITE_URL)
    expect(fetchMembersMock).not.toHaveBeenCalled()

    // Leaves; is downgraded to viewer; the session refetch lands and
    // useScopeReset empties the cache.
    await page.show(null)
    client.setQueryData(queryKeys.session, { session: viewer })
    await resetScopedQueries(client)
    expect(client.getQueryData(queryKeys.invitations)).toBeUndefined()

    // Back: Next mounts the same payload again, without the server.
    await page.show(payload)
    expect(client.getQueryData(queryKeys.members)).toBeUndefined()
    expect(client.getQueryData(queryKeys.invitations)).toBeUndefined()
    expect(screen.getByTestId("invite")).toHaveTextContent("none")
    expect(screen.queryByText(INVITE_URL)).not.toBeInTheDocument()
    // The hooks ask the server, which answers for the viewer.
    expect(fetchMembersMock).toHaveBeenCalled()
    expect(fetchInvitationsMock).toHaveBeenCalled()
    expect(await screen.findByText("refused")).toBeInTheDocument()
  })

  it("still hydrates a payload read for the live session, on Back too", async () => {
    const client = signedIn(admin)
    const page = mount(client)
    const payload = teamPayload(admin)
    await page.show(payload)
    await page.show(null)
    await page.show(payload)
    expect(screen.getByTestId("invite")).toHaveTextContent(INVITE_URL)
    expect(fetchMembersMock).not.toHaveBeenCalled()
    expect(fetchInvitationsMock).not.toHaveBeenCalled()
  })

  // Notifications and Reply policy are prefetched the same way (and Inbox,
  // the listing pages and their streamed tabs): one rule in the boundary.
  const pages: [string, QueryKey][] = [
    ["Notifications", queryKeys.notificationPreferences],
    ["Reply policy", queryKeys.settings],
  ]
  for (const [name, queryKey] of pages) {
    it(`refuses a ${name} payload read for another role, person or organisation`, async () => {
      const queryFn = vi.fn(() => new Promise<never>(() => {}))
      function Probe() {
        const query = useQuery({ queryKey, queryFn })
        return <p data-testid="probe">{query.data ? "hydrated" : "fetching"}</p>
      }
      for (const live of [
        viewer,
        session({ userId: "00000000-0000-4000-8000-000000000003" }),
        session({ organisationId: "00000000-0000-4000-8000-000000000009" }),
        session({ scopeFingerprint: "narrower" }),
      ]) {
        const server = new QueryClient()
        server.setQueryData(queryKey, { read: "for the admin" })
        const payload = {
          ...dehydrate(server),
          scope: sessionScopeToken(admin),
        }
        const client = signedIn(live)
        const view = render(
          <QueryClientProvider client={client}>
            <HydrationBoundary state={payload}>
              <Probe />
            </HydrationBoundary>
          </QueryClientProvider>
        )
        expect(client.getQueryData(queryKey)).toBeUndefined()
        expect(screen.getByTestId("probe")).toHaveTextContent("fetching")
        view.unmount()
      }
      expect(queryFn).toHaveBeenCalledTimes(4)
    })
  }
})

describe("inLiveScope", () => {
  const state = { queries: [], mutations: [], scope: sessionScopeToken(admin) }

  it("passes a payload for the live scope and refuses any other", () => {
    expect(inLiveScope(state, signedIn(admin))).toBe(state)
    expect(inLiveScope(state, signedIn(viewer))).toBeUndefined()
  })

  it("refuses a stamped payload when no one is signed in", () => {
    expect(inLiveScope(state, new QueryClient())).toBeUndefined()
  })

  it("leaves an unstamped payload (the dashboard layout's) alone", () => {
    const layout = { queries: [], mutations: [] }
    expect(inLiveScope(layout, new QueryClient())).toBe(layout)
  })
})
