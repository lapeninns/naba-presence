import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, expect, it, vi } from "vitest"

import { useNotificationChanges } from "@/components/notifications/use-notification-changes"
import type { NotificationListResponse } from "@/lib/contracts/operational-notifications"
import type { SessionResponse } from "@/lib/contracts/session"
import { storeFor } from "@/lib/api/operational-notifications"
import { queryKeys } from "@/lib/queries/keys"

import { OWNER, page, row } from "./notification-count-harness"

afterEach(() => vi.unstubAllGlobals())

/**
 * A shell poll that left before a change saved seeds the badge from inside
 * its own query function, so cancelling the query does not stop an answer that
 * has already come back and is only a few promise turns from being written.
 * Such an answer predates the change and must not land after its commit and
 * be taken for the server's word. Run with the write landing 0 to 120 turns
 * after the poll's answer arrives, whichever side of the commit that falls.
 */
it.each(Array.from({ length: 41 }, (_, at) => at * 3))(
  "keeps the committed count when a shell poll from before the save seeds the badge %i turns late",
  async (turns) => {
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
    let answerRead: (() => void) | null = null
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/api/notifications/read")) {
          await new Promise<void>((resolve) => (answerRead = resolve))
          return new Response(JSON.stringify({ updated: 1 }), {
            headers: { "content-type": "application/json" },
          })
        }
        // The refetch after the commit: hold it, the count is read as it is.
        return new Promise<Response>(() => {})
      })
    )
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useNotificationChanges(), { wrapper })
    // The poll left before the save: it still says x is unread, count 2.
    let answerPoll = () => {}
    // Cancelling it rejects it with CancelledError, which is expected here:
    // the rejection is handled, not left unhandled.
    const poll = client
      .fetchQuery({
        queryKey: queryKeys.shellStatus,
        queryFn: async () => {
          await new Promise<void>((resolve) => (answerPoll = resolve))
          for (let turn = 0; turn < turns; turn++) await Promise.resolve()
          client.setQueryData<NotificationListResponse>(
            queryKeys.notifications("badge"),
            page([row("x"), row("y")])
          )
          return null
        },
      })
      .catch(() => "cancelled")
    act(() => result.current.markRead(["x"], true))
    // Both answers come back together, once the save has reached the server.
    await vi.waitFor(() => expect(answerRead).not.toBeNull())
    await act(async () => {
      answerRead!()
      answerPoll()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    await poll
    expect(storeFor(client).changes).toHaveLength(0)
    expect(
      client.getQueryData<NotificationListResponse>(
        queryKeys.notifications("badge")
      )?.unreadCount
    ).toBe(1)
  }
)
