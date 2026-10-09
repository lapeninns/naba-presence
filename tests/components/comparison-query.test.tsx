import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as hoursApi from "@/lib/api/location-hours"
import * as profileApi from "@/lib/api/location-profile"
import { useHours } from "@/lib/queries/use-location-hours"
import { useProfile } from "@/lib/queries/use-location-profile"
import { queryKeys } from "@/lib/queries/keys"

afterEach(() => vi.restoreAllMocks())
describe("failed comparison query invalidation", () => {
  it.each(["hours", "profile"] as const)(
    "invalidates all health consumers after failed %s read",
    async (area) => {
      vi.spyOn(hoursApi, "fetchHours").mockRejectedValue(
        new Error("Synthetic provider failure")
      )
      vi.spyOn(profileApi, "fetchProfile").mockRejectedValue(
        new Error("Synthetic provider failure")
      )
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
      const invalidate = vi.spyOn(client, "invalidateQueries")
      const hook = area === "hours" ? useHours : useProfile
      const { result } = renderHook(() => hook("l1"), {
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
    }
  )
})
