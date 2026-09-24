import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { RefreshGoogleButton } from "@/components/performance/refresh-google-button"
import { Toaster } from "@/components/ui/toast"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderButton(canTrigger: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <RefreshGoogleButton kind="performance" canTrigger={canTrigger} />
      </Toaster>
    </QueryClientProvider>
  )
}

describe("RefreshGoogleButton", () => {
  it("is not rendered for a caller who cannot trigger a sync", () => {
    renderButton(false)
    expect(
      screen.queryByRole("button", { name: /refresh from google/i })
    ).not.toBeInTheDocument()
  })
  it("POSTs the performance sync and shows a pending state", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ organisations: [], skipped: false, nextCursor: null }), { headers: { "content-type": "application/json" } }))
    vi.stubGlobal("fetch", fetchMock)
    renderButton(true)
    await userEvent.click(screen.getByRole("button", { name: /refresh from google/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe("/api/sync/performance")
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST")
    // Success is said, not left to an unchanged-looking page.
    expect(await screen.findByText("Refresh started")).toBeInTheDocument()
  })
  it("says why a refresh could not start", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: "sync_in_progress", message: "busy" }), { status: 409, headers: { "content-type": "application/json" } })))
    renderButton(true)
    await userEvent.click(screen.getByRole("button", { name: /refresh from google/i }))
    expect(await screen.findByRole("alert")).toHaveTextContent(/already running/)
  })
})
