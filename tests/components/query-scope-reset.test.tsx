import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query"
import { act, render, renderHook, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { apiFetch } from "@/lib/api/client"
import { __resetDraftSources, peekStashedDraft, stashDraft } from "@/lib/api/draft-stash"
import type { SessionResponse, SessionUser } from "@/lib/contracts/session"
import { draftKey } from "@/lib/editors/draft-key"
import { queryKeys } from "@/lib/queries/keys"
import {
  resourcePrefixesForPath,
  sessionScopeToken,
  useScopeReset,
} from "@/lib/queries/scope-reset"

beforeEach(() => {
  __resetDraftSources()
  sessionStorage.clear()
})
afterEach(() => vi.restoreAllMocks())

const BASE: SessionUser = {
  userId: "u1",
  organisationId: "o1",
  organisationName: "Org",
  displayName: "Person",
  email: "person@example.com",
  role: "member",
  canPublish: false,
  workspaceMode: "business",
  scopeFingerprint: "fp-1",
}

function setSession(client: QueryClient, session: SessionUser | null) {
  client.setQueryData<SessionResponse>(queryKeys.session, { session })
}

function setup(session: SessionUser | null = BASE) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  setSession(client, session)
  const hook = renderHook(() => useScopeReset(client))
  return { client, hook }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("sessionScopeToken", () => {
  it("changes with the user, organisation, role, publish right and fingerprint", () => {
    const base = sessionScopeToken(BASE)
    expect(sessionScopeToken({ ...BASE })).toBe(base)
    for (const changed of [
      { userId: "u2" },
      { organisationId: "o2" },
      { role: "viewer" as const },
      { canPublish: true },
      { scopeFingerprint: "fp-2" },
    ]) {
      expect(sessionScopeToken({ ...BASE, ...changed })).not.toBe(base)
    }
    // A name or mode change is not a scope change.
    expect(sessionScopeToken({ ...BASE, organisationName: "Renamed" })).toBe(base)
    expect(sessionScopeToken(null)).toBe("")
  })
})

describe("useScopeReset", () => {
  it("keeps the cache while the scope stays the same", () => {
    const { client } = setup()
    client.setQueryData(queryKeys.locationHours("loc-1"), { hours: 1 })
    act(() => setSession(client, { ...BASE, organisationName: "Renamed" }))
    expect(client.getQueryData(queryKeys.locationHours("loc-1"))).toEqual({ hours: 1 })
  })

  it.each([
    ["role", { role: "viewer" as const }],
    ["scope fingerprint", { scopeFingerprint: "fp-2" }],
    ["user", { userId: "u2" }],
    ["organisation", { organisationId: "o2" }],
  ])("clears everything but the session when the %s changes", (_label, change) => {
    const { client } = setup()
    client.setQueryData(queryKeys.locationHours("loc-1"), { hours: 1 })
    client.setQueryData(queryKeys.members, ["someone"])
    act(() => setSession(client, { ...BASE, ...change }))
    expect(client.getQueryData(queryKeys.locationHours("loc-1"))).toBeUndefined()
    expect(client.getQueryData(queryKeys.members)).toBeUndefined()
    expect(
      client.getQueryData<SessionResponse>(queryKeys.session)?.session
    ).toMatchObject(change)
  })

  it("clears the cache when the session goes away", () => {
    const { client } = setup()
    client.setQueryData(queryKeys.members, ["someone"])
    act(() => setSession(client, null))
    expect(client.getQueryData(queryKeys.members)).toBeUndefined()
  })

  it("empties and refetches a mounted query instead of orphaning it", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    setSession(client, BASE)
    let answer = "wide"
    function Probe() {
      useScopeReset(client)
      const { data } = useQuery({
        queryKey: queryKeys.members,
        queryFn: async () => answer,
      })
      return <p>{data ?? "loading"}</p>
    }
    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    )
    await screen.findByText("wide")
    answer = "narrow"
    act(() => setSession(client, { ...BASE, scopeFingerprint: "fp-2" }))
    await screen.findByText("narrow")
  })

  it("purges another identity's stashed drafts once the session is known", () => {
    const scope = { resource: "location-hours", resourceId: "loc-1", schemaVersion: 1 }
    const mine = draftKey({ userId: "u1", organisationId: "o1", ...scope })
    const theirs = draftKey({ userId: "u9", organisationId: "o1", ...scope })
    stashDraft(mine, "{}")
    stashDraft(theirs, "{}")
    setup()
    expect(peekStashedDraft(mine)).toBe("{}")
    expect(peekStashedDraft(theirs)).toBeNull()
  })

  it("purges the previous identity's drafts when another person's session arrives", () => {
    const { client } = setup()
    const scope = { resource: "inbox-reply", resourceId: "rev-1", schemaVersion: 1 }
    const first = draftKey({ userId: "u1", organisationId: "o1", ...scope })
    stashDraft(first, "half a reply")
    act(() => setSession(client, { ...BASE, userId: "u2" }))
    expect(peekStashedDraft(first)).toBeNull()
  })

  it("keeps drafts when the session only goes away", () => {
    const { client } = setup()
    const key = draftKey({ userId: "u1", organisationId: "o1", resource: "x", schemaVersion: 1 })
    stashDraft(key, "kept for signing back in")
    act(() => setSession(client, null))
    expect(peekStashedDraft(key)).toBe("kept for signing back in")
  })
})

describe("access lost", () => {
  it("names every root a location or client is cached under", () => {
    expect(resourcePrefixesForPath("/api/locations/loc-1/hours")).toEqual([
      ["locations", "loc-1"],
      queryKeys.locationCapabilities("loc-1"),
      queryKeys.listingSummary("loc-1"),
      queryKeys.listingChangeRequests("loc-1"),
    ])
    expect(resourcePrefixesForPath("/api/clients/c%201?x=1")).toEqual([
      queryKeys.client("c 1"),
    ])
    expect(resourcePrefixesForPath("/api/reviews/r1")).toEqual([])
  })

  it("drops the location's cache on a refused read and leaves other locations alone", async () => {
    const { client } = setup()
    client.setQueryData(queryKeys.locationHours("loc-1"), { hours: 1 })
    client.setQueryData(queryKeys.locationCapabilities("loc-1"), { canEdit: true })
    client.setQueryData(queryKeys.listingSummary("loc-1"), { state: "ok" })
    client.setQueryData(queryKeys.locationHours("loc-2"), { hours: 2 })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({ error: "permission_denied", message: "No." }, 403)
    )
    await expect(
      apiFetch("/api/locations/loc-1/insights")
    ).rejects.toMatchObject({ status: 403 })
    expect(client.getQueryData(queryKeys.locationHours("loc-1"))).toBeUndefined()
    expect(client.getQueryData(queryKeys.locationCapabilities("loc-1"))).toBeUndefined()
    expect(client.getQueryData(queryKeys.listingSummary("loc-1"))).toBeUndefined()
    expect(client.getQueryData(queryKeys.locationHours("loc-2"))).toEqual({ hours: 2 })
  })

  it("refetches in place, keeping the data, when an action is refused", async () => {
    const { client } = setup()
    client.setQueryData(queryKeys.locationHours("loc-1"), { hours: 1 })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({ error: "publish_not_allowed", message: "No." }, 403)
    )
    await expect(
      apiFetch("/api/locations/loc-1/hours", { method: "PATCH", body: {} })
    ).rejects.toMatchObject({ status: 403 })
    expect(client.getQueryData(queryKeys.locationHours("loc-1"))).toEqual({ hours: 1 })
    expect(client.getQueryState(queryKeys.locationHours("loc-1"))?.isInvalidated).toBe(true)
  })

  it("drops a location's posts on the default 404 of a location access check", async () => {
    const { client } = setup()
    client.setQueryData(queryKeys.locationPosts("loc-1"), { posts: ["hidden"] })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({ error: "review_not_found", message: "Not found." }, 404)
    )
    await expect(apiFetch("/api/locations/loc-1/posts")).rejects.toMatchObject({
      status: 404,
    })
    expect(client.getQueryData(queryKeys.locationPosts("loc-1"))).toBeUndefined()
  })

  it("refetches the session on an access-lost answer, which resets a changed scope", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    setSession(client, BASE)
    client.setQueryData(queryKeys.members, ["someone"])
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input) === "/api/session"
        ? json({ session: { ...BASE, scopeFingerprint: "fp-2" } })
        : json({ error: "permission_denied", message: "No." }, 403)
    )
    function Probe() {
      useScopeReset(client)
      useQuery({
        queryKey: queryKeys.session,
        queryFn: () => apiFetch<SessionResponse>("/api/session"),
      })
      return null
    }
    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    )
    await expect(apiFetch("/api/locations/loc-1/insights")).rejects.toMatchObject({
      status: 403,
    })
    await waitFor(() =>
      expect(client.getQueryData(queryKeys.members)).toBeUndefined()
    )
  })

  it("drops a client's cache on its hidden-client 404 and refreshes the directories", async () => {
    const { client } = setup()
    client.setQueryData(queryKeys.client("c1"), { name: "Old Crown" })
    client.setQueryData(queryKeys.locations, [{ id: "loc-1" }])
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({ error: "client_not_found", message: "Gone." }, 404)
    )
    await expect(apiFetch("/api/clients/c1")).rejects.toMatchObject({ status: 404 })
    expect(client.getQueryData(queryKeys.client("c1"))).toBeUndefined()
    expect(client.getQueryState(queryKeys.locations)?.isInvalidated).toBe(true)
  })

  it("leaves the cache alone for answers that are not about access", async () => {
    const { client } = setup()
    client.setQueryData(queryKeys.locationHours("loc-1"), { hours: 1 })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({ error: "revision_conflict", message: "Stale." }, 409)
    )
    await expect(
      apiFetch("/api/locations/loc-1/hours", { method: "PATCH", body: {} })
    ).rejects.toMatchObject({ status: 409 })
    expect(client.getQueryData(queryKeys.locationHours("loc-1"))).toEqual({ hours: 1 })
  })

  it("does not refetch a mounted query for ever when it keeps being refused", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    setSession(client, BASE)
    let reads = 0
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        if (String(input).endsWith("/insights")) {
          return json({ error: "permission_denied", message: "No." }, 403)
        }
        reads += 1
        return reads === 1
          ? json({ hours: "wide" })
          : json({ error: "location_not_found", message: "Gone." }, 404)
      })
    function Probe() {
      useScopeReset(client)
      const { status, data } = useQuery({
        queryKey: queryKeys.locationHours("loc-1"),
        queryFn: () => apiFetch<{ hours: string }>("/api/locations/loc-1/hours"),
      })
      return <p>{data?.hours ?? status}</p>
    }
    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    )
    await screen.findByText("wide")
    await expect(
      apiFetch("/api/locations/loc-1/insights")
    ).rejects.toMatchObject({ status: 403 })
    // The old data goes; the refetch is refused and leaves nothing to reset.
    await screen.findByText("error")
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(reads).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("stops reporting once the provider unmounts", async () => {
    const { client, hook } = setup()
    client.setQueryData(queryKeys.locationHours("loc-1"), { hours: 1 })
    hook.unmount()
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({ error: "permission_denied", message: "No." }, 403)
    )
    await expect(
      apiFetch("/api/locations/loc-1/hours", { method: "PATCH", body: {} })
    ).rejects.toMatchObject({ status: 403 })
    await waitFor(() =>
      expect(client.getQueryData(queryKeys.locationHours("loc-1"))).toEqual({ hours: 1 })
    )
  })
})
