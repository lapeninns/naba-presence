import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as menuApi from "@/lib/api/location-menu"
import { queryKeys } from "@/lib/queries/keys"
import { useFoodMenus } from "@/lib/queries/use-location-menu"

const state: menuApi.FoodMenusState = {
  location: { id: "l1", name: "Pub", googleLocationName: "locations/1" },
  canonicalResource: { revision: "1", updatedAt: "today" },
  eligible: true,
  status: "in_sync",
  canonicalMenus: [],
  googleMenus: [],
  canonicalHash: "same",
  googleHash: "same",
  canonicalCounts: { menus: 0, sections: 0, items: 0, options: 0 },
  googleCounts: { menus: 0, sections: 0, items: 0, options: 0 },
  canPublish: true,
  writesEnabled: true,
}
afterEach(() => vi.restoreAllMocks())

describe("menu observation invalidation", () => {
  it("refreshes overview board and client aggregates after the first successful read", async () => {
    vi.spyOn(menuApi, "fetchFoodMenus").mockResolvedValue(state)
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const invalidate = vi.spyOn(client, "invalidateQueries")
    const { result } = renderHook(() => useFoodMenus("l1"), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    for (const queryKey of [
      queryKeys.listingSummary("l1"),
      queryKeys.listingSummaries,
      queryKeys.clientsAll,
    ])
      expect(invalidate).toHaveBeenCalledWith({ queryKey })
  })
  it("refreshes aggregates so a failed read cannot leave a cached healthy label", async () => {
    vi.spyOn(menuApi, "fetchFoodMenus").mockRejectedValue(
      new Error("unreachable")
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const invalidate = vi.spyOn(client, "invalidateQueries")
    const { result } = renderHook(() => useFoodMenus("l1"), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    for (const queryKey of [
      queryKeys.listingSummary("l1"),
      queryKeys.listingSummaries,
      queryKeys.clientsAll,
    ])
      expect(invalidate).toHaveBeenCalledWith({ queryKey })
  })
})
