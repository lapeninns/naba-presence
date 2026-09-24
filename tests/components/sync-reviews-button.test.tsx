import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SyncReviewsButton } from "@/components/inbox/sync-reviews-button"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderButton(canSync: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SyncReviewsButton canSync={canSync} />
    </QueryClientProvider>
  )
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("SyncReviewsButton", () => {
  it("is hidden when this person cannot sync", () => {
    const { container } = renderButton(false)
    expect(container).toBeEmptyDOMElement()
  })

  it("reconciles reviews from Google", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json({ processed: 1, nextCursor: null, failures: [] })
    )
    vi.stubGlobal("fetch", fetchMock)
    renderButton(true)
    await userEvent.click(screen.getByRole("button", { name: "Sync reviews" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe("/api/sync/reconcile")
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST")
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("says when a sync is already running", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        json({ skipped: true, processed: 0, nextCursor: null, failures: [] })
      )
    )
    renderButton(true)
    await userEvent.click(screen.getByRole("button", { name: "Sync reviews" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A sync is already running"
    )
  })
})
