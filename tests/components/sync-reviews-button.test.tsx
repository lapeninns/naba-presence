import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SyncReviewsButton } from "@/components/inbox/sync-reviews-button"
import { Toaster } from "@/components/ui/toast"
import { queryKeys } from "@/lib/queries/keys"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderButton(canSync: boolean, totalBefore?: number) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  if (totalBefore !== undefined) {
    client.setQueryData(queryKeys.reviewCounts("organisation"), {
      total: totalBefore,
      byStatus: {},
      byQueue: {},
    })
  }
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <SyncReviewsButton canSync={canSync} />
      </Toaster>
    </QueryClientProvider>
  )
}

function counts(total: number) {
  return {
    total,
    byStatus: {},
    byQueue: {
      needs_reply: 0,
      approval: 0,
      awaiting_my_approval: 0,
      awaiting_others: 0,
      publishing: 0,
      failed: 0,
      done: 0,
      all: total,
    },
  }
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

  it.each([
    [12, 15, "3 new reviews"],
    [12, 12, "Up to date"],
  ])(
    "says what the sync found (%i before, %i after)",
    async (before, after, title) => {
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (input) =>
          String(input).startsWith("/api/reviews/counts")
            ? json(counts(after))
            : json({ processed: 1, nextCursor: null, failures: [] })
        )
      )
      renderButton(true, before)
      await userEvent.click(
        screen.getByRole("button", { name: "Sync reviews" })
      )
      expect(await screen.findByText(title)).toBeInTheDocument()
    }
  )

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
