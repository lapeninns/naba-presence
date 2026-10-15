import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ClientScopeRoot } from "@/components/app-shell/client-context"
import {
  inboxName,
  useNeedsReplyCount,
} from "@/components/app-shell/use-needs-reply-count"
import { queryKeys } from "@/lib/queries/keys"

const navigation = vi.hoisted(() => ({
  pathname: "/team" as string | null,
  search: "",
}))

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

function counts(needsReply: number) {
  return {
    total: needsReply,
    byStatus: {},
    byQueue: {
      needs_reply: needsReply,
      approval: 0,
      awaiting_my_approval: 0,
      awaiting_others: 0,
      publishing: 0,
      failed: 0,
      done: 0,
      all: needsReply,
    },
  }
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function wrapperWith(client: QueryClient, rememberedClientId: string | null) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ClientScopeRoot rememberedClientId={rememberedClientId}>
          {children}
        </ClientScopeRoot>
      </QueryClientProvider>
    )
  }
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

beforeEach(() => {
  navigation.pathname = "/team"
  navigation.search = ""
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("useNeedsReplyCount", () => {
  it("reads the organisation-wide count when no client is in scope", async () => {
    const client = newClient()
    client.setQueryData(queryKeys.reviewCountsFor(), counts(9))
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useNeedsReplyCount(), {
      wrapper: wrapperWith(client, null),
    })
    await waitFor(() => expect(result.current).toBe(9))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("follows the client scope, so the badge agrees with the scoped title", async () => {
    // The organisation has 9 waiting; the client in scope has 2. The Inbox
    // title counts the scoped queue, so the badge must too.
    const client = newClient()
    client.setQueryData(queryKeys.reviewCountsFor(), counts(9))
    const fetchMock = vi.fn(async () => jsonResponse(counts(2)))
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useNeedsReplyCount(), {
      wrapper: wrapperWith(client, "client-1"),
    })
    await waitFor(() => expect(result.current).toBe(2))
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reviews/counts?client_id=client-1",
      expect.anything()
    )
    expect(
      client.getQueryData(queryKeys.reviewCountsFor({ clientId: "client-1" }))
    ).toEqual(counts(2))
  })

  it("takes the scope from the address on the Inbox, whatever is remembered", async () => {
    // /inbox?clientId=client-2 counts client-2 in the title, so the badge
    // must too, even with client-1 remembered.
    navigation.pathname = "/inbox"
    navigation.search = "clientId=client-2"
    const client = newClient()
    client.setQueryData(queryKeys.reviewCountsFor(), counts(9))
    const fetchMock = vi.fn(async () => jsonResponse(counts(3)))
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useNeedsReplyCount(), {
      wrapper: wrapperWith(client, "client-1"),
    })
    await waitFor(() => expect(result.current).toBe(3))
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reviews/counts?client_id=client-2",
      expect.anything()
    )
  })

  it("reads the organisation-wide count on the Inbox with no client in the address, even with one remembered", async () => {
    navigation.pathname = "/inbox"
    navigation.search = "selected=review-1"
    const client = newClient()
    client.setQueryData(queryKeys.reviewCountsFor(), counts(9))
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useNeedsReplyCount(), {
      wrapper: wrapperWith(client, "client-1"),
    })
    await waitFor(() => expect(result.current).toBe(9))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("ignores a remembered client in a business, which has no client scope", async () => {
    const client = newClient()
    client.setQueryData(queryKeys.session, {
      session: { workspaceMode: "business" },
    })
    client.setQueryData(queryKeys.reviewCountsFor(), counts(9))
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useNeedsReplyCount(), {
      wrapper: wrapperWith(client, "client-1"),
    })
    await waitFor(() => expect(result.current).toBe(9))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("makes no request while disabled", () => {
    const client = newClient()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useNeedsReplyCount(false), {
      wrapper: wrapperWith(client, "client-1"),
    })
    expect(result.current).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("inboxName", () => {
  it("carries the count in the tab's name", () => {
    expect(inboxName(undefined)).toBe("Inbox")
    expect(inboxName(0)).toBe("Inbox")
    expect(inboxName(1)).toBe("Inbox, 1 needs a reply")
    expect(inboxName(2)).toBe("Inbox, 2 need a reply")
  })
})
