import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Toaster } from "@/components/ui/toast"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"
import * as connectionsApi from "@/lib/api/connections"
import { ApiClientError } from "@/lib/api/client"

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  // useConnectionWorkspace calls useToastManager (mutation onError), which requires a
  // Toast provider — wrap in <Toaster> or the real hook throws under renderHook.
  return (
    <QueryClientProvider client={client}>
      <Toaster>{children}</Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.restoreAllMocks())

describe("useConnectionWorkspace", () => {
  it("hands off to Google via window.location.assign on connect", async () => {
    vi.spyOn(connectionsApi, "fetchConnections").mockResolvedValue({
      connections: [],
    })
    vi.spyOn(connectionsApi, "startGoogleConnect").mockResolvedValue({
      authorizationUrl: "https://accounts.google.test/o/oauth2/v2/auth?x=1",
    })
    const assign = vi.fn()
    vi.stubGlobal("location", { ...window.location, assign })
    const { result } = renderHook(() => useConnectionWorkspace(), { wrapper })
    await act(async () => {
      result.current.connect.mutate({})
    })
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        "https://accounts.google.test/o/oauth2/v2/auth?x=1"
      )
    )
    vi.unstubAllGlobals()
  })

  it("leaves a failed disconnect to the dialog: no toast of its own", async () => {
    vi.spyOn(connectionsApi, "fetchConnections").mockResolvedValue({
      connections: [],
    })
    vi.spyOn(connectionsApi, "disconnectConnection").mockRejectedValue(
      new ApiClientError(503, "service_unavailable", "Unavailable")
    )
    const { result } = renderHook(() => useConnectionWorkspace(), { wrapper })
    await act(async () => {
      result.current.disconnect.mutate("c1")
    })
    await waitFor(() => expect(result.current.disconnect.isError).toBe(true))
    expect(screen.queryByRole("status")?.textContent ?? "").not.toMatch(/\S/)
    expect(document.querySelector('[data-slot="toast"]')).toBeNull()
  })
})
