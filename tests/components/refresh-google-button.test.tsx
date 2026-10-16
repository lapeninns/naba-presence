import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReportActionsMenu } from "@/components/reporting/report-actions-menu"
import { Toaster } from "@/components/ui/toast"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderMenu(canTrigger: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <ReportActionsMenu
          refresh={canTrigger ? { kind: "performance" } : null}
        />
      </Toaster>
    </QueryClientProvider>
  )
}

async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: "More actions" }))
}

// "Refresh from Google" lives in the report's actions menu (CLR-02); what it
// asks Google for, and what it says back, is unchanged.
describe("Refresh from Google in the report's actions menu", () => {
  it("is not in the menu, or the menu drawn at all, for a caller who cannot trigger a sync", () => {
    renderMenu(false)
    expect(
      screen.queryByRole("button", { name: "More actions" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("menuitem", { name: /refresh from google/i })
    ).not.toBeInTheDocument()
  })
  it("POSTs the performance sync and shows a pending state", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ organisations: [], skipped: false, nextCursor: null }), { headers: { "content-type": "application/json" } }))
    vi.stubGlobal("fetch", fetchMock)
    renderMenu(true)
    await openMenu()
    await userEvent.click(await screen.findByRole("menuitem", { name: /refresh from google/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe("/api/sync/performance")
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST")
    // Success is said, not left to an unchanged-looking page.
    expect(await screen.findByText("Refresh started")).toBeInTheDocument()
  })
  it("says why a refresh could not start, beside the menu button", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: "sync_in_progress", message: "busy" }), { status: 409, headers: { "content-type": "application/json" } })))
    renderMenu(true)
    await openMenu()
    await userEvent.click(await screen.findByRole("menuitem", { name: /refresh from google/i }))
    expect(await screen.findByRole("alert")).toHaveTextContent(/already running/)
  })
})
