import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, expect, it, vi } from "vitest"

import { useNotificationChanges } from "@/components/notifications/use-notification-changes"
import {
  storeFor,
  usePendingUnreadDelta,
} from "@/lib/api/operational-notifications"
import type { NotificationListResponse } from "@/lib/contracts/operational-notifications"
import type { SessionResponse } from "@/lib/contracts/session"
import { queryKeys } from "@/lib/queries/keys"
import { useShellStatus } from "@/lib/queries/use-shell-status"

import { OWNER, page, row } from "./notification-count-harness"

const mocked = vi.hoisted(() => ({ shell: vi.fn() }))
vi.mock("@/lib/api/shell-status", () => ({ fetchShellStatus: mocked.shell }))

afterEach(() => {
  vi.unstubAllGlobals()
  mocked.shell.mockReset()
})

/**
 * Two reads are queued (X, then Y). X saves and commits; Y is still pending.
 * A shell poll that left before X saved comes back only now, in a later timer
 * task, after the commit cancelled it. Its answer still says X and Y are
 * unread, count 2. The real `useShellStatus` query function must not seed the
 * badge from a poll that was cancelled while its answer was on the way, or
 * the committed X is lost and the bell shows 1 (raw badge 2) with both rows
 * read.
 */
it.each([0, 10, 50])(
  "does not let a cancelled shell poll that answers %i ms after the commit undo it",
  async (later) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    client.setQueryData<SessionResponse>(queryKeys.session, { session: OWNER })
    const both = page([row("x"), row("y")])
    client.setQueryData(queryKeys.notifications("badge"), both)
    client.setQueryData(queryKeys.notifications("all"), {
      pages: [both],
      pageParams: [""],
    })
    let answerPoll!: () => void
    let pollSignal!: AbortSignal
    mocked.shell.mockImplementation(
      async ({ signal }: { signal: AbortSignal }) => {
        pollSignal = signal
        await new Promise<void>((resolve) => (answerPoll = resolve))
        return {
          counts: {},
          connections: [],
          notifications: page([row("x"), row("y")]),
        }
      }
    )
    const readReplies: Array<() => void> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/api/notifications/read")) {
          await new Promise<void>((resolve) => readReplies.push(resolve))
          return new Response(JSON.stringify({ updated: 1 }), {
            headers: { "content-type": "application/json" },
          })
        }
        return new Promise<Response>(() => {})
      })
    )
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const hook = renderHook(
      () => {
        const badge = useQuery<NotificationListResponse | null>({
          queryKey: queryKeys.notifications("badge"),
          queryFn: async () => null,
          enabled: false,
        })
        const delta = usePendingUnreadDelta("badge")
        return {
          actions: useNotificationChanges(),
          shell: useShellStatus(false),
          bell: Math.max(0, (badge.data?.unreadCount ?? 0) + delta),
        }
      },
      { wrapper }
    )
    let poll!: Promise<unknown>
    act(() => {
      poll = hook.result.current.shell.refetch().catch(() => null)
    })
    await waitFor(() => expect(answerPoll).toBeTypeOf("function"))
    act(() => {
      hook.result.current.actions.markRead(["x"], true)
      hook.result.current.actions.markRead(["y"], true)
    })
    await waitFor(() => expect(readReplies).toHaveLength(1))
    await act(async () => readReplies[0]!())
    await waitFor(() => expect(readReplies).toHaveLength(2))
    await waitFor(() => expect(storeFor(client).changes).toHaveLength(1))
    expect(pollSignal.aborted).toBe(true)
    expect(hook.result.current.bell).toBe(0)
    // The old answer arrives in a later task, while Y is still pending.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, later))
      answerPoll()
      await poll
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(storeFor(client).changes).toHaveLength(1)
    expect(hook.result.current.bell).toBe(0)
    expect(
      client.getQueryData<NotificationListResponse>(
        queryKeys.notifications("badge")
      )?.unreadCount
    ).not.toBe(2)
    // Y saves: nothing is unread, and the committed count is the server's.
    await act(async () => readReplies[1]!())
    await waitFor(() => expect(storeFor(client).changes).toHaveLength(0))
    expect(
      client.getQueryData<NotificationListResponse>(
        queryKeys.notifications("badge")
      )?.unreadCount
    ).toBe(0)
    hook.unmount()
    client.clear()
  }
)
