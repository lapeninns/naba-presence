import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import type { PropsWithChildren } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchOutboxCounts } from "@/lib/outbox/api"
import { outboxKeys } from "@/lib/outbox/keys"
import { OUTBOX_SETTLING_MS, useOutboxCounts } from "@/lib/outbox/queries"

vi.mock("@/lib/outbox/api", () => ({ fetchOutboxCounts: vi.fn() }))

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("Outbox counts", () => {
  it.each([{ clientId: "client" }, { locationId: "listing" }])(
    "refreshes $clientId$locationId counts while Google is settling",
    async (scope) => {
      vi.useFakeTimers()
      const client = new QueryClient({
        defaultOptions: { queries: { staleTime: Infinity, retry: false } },
      })
      const key = outboxKeys.counts(scope)
      const pending = {
        person: 0,
        google: 1,
        failed: 0,
        live: 0,
        partial: false,
      }
      const settled = { ...pending, google: 0, live: 1 }
      client.setQueryData(key, pending)
      vi.mocked(fetchOutboxCounts).mockResolvedValue(settled)
      const hook = renderHook(() => useOutboxCounts(scope), {
        wrapper: ({ children }: PropsWithChildren) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      })
      try {
        await act(() => vi.advanceTimersByTimeAsync(OUTBOX_SETTLING_MS))
        expect(fetchOutboxCounts).toHaveBeenCalledWith(scope, expect.anything())
        expect(client.getQueryData(key)).toEqual(settled)
        await act(() => vi.advanceTimersByTimeAsync(OUTBOX_SETTLING_MS))
        expect(fetchOutboxCounts).toHaveBeenCalledTimes(1)
      } finally {
        hook.unmount()
        client.clear()
      }
    }
  )
})
