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
    // A toast, like the success, not a caption that stays under the icon.
    expect(
      await screen.findByText(
        "A sync is already running. Try again in a moment."
      )
    ).toBeInTheDocument()
    expect(screen.getByText("Could not sync reviews")).toBeInTheDocument()
    expect(document.querySelector('[data-slot="toast"]')).toHaveAttribute(
      "data-type",
      "error"
    )
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Sync reviews" })).toBeEnabled()
  })

  it("reports a failed sync as a toast", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        json({ error: { code: "internal_error", message: "x" } }, 500)
      )
    )
    renderButton(true)
    await userEvent.click(screen.getByRole("button", { name: "Sync reviews" }))
    expect(
      await screen.findByText("Could not sync reviews")
    ).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("reports a Google failure inside a finished sync as a toast", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        json({
          processed: 0,
          nextCursor: null,
          failures: [{ errorCode: "google_unavailable" }],
        })
      )
    )
    renderButton(true)
    await userEvent.click(screen.getByRole("button", { name: "Sync reviews" }))
    expect(
      await screen.findByText("Could not sync reviews")
    ).toBeInTheDocument()
    expect(screen.queryByText("Reviews synced")).not.toBeInTheDocument()
  })

  // One toast id for every outcome: a result replaces the one before it.
  describe("one toast at a time", () => {
    /** Reconcile answers from `outcomes` in turn; the counts read answers 12. */
    function stubOutcomes(outcomes: Response[]) {
      const queue = [...outcomes]
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (input) =>
          String(input).startsWith("/api/reviews/counts")
            ? json(counts(12))
            : (queue.shift() ??
              json({ error: { code: "internal_error" } }, 500))
        )
      )
    }
    const skipped = () =>
      json({ skipped: true, processed: 0, nextCursor: null, failures: [] })
    const succeeded = () =>
      json({ processed: 1, nextCursor: null, failures: [] })
    const failed = () => json({ error: { code: "internal_error" } }, 500)

    it("replaces a skipped sync's toast with the retry's success", async () => {
      stubOutcomes([skipped(), succeeded()])
      renderButton(true, 12)
      const sync = screen.getByRole("button", { name: "Sync reviews" })

      await userEvent.click(sync)
      expect(
        await screen.findByText(
          "A sync is already running. Try again in a moment."
        )
      ).toBeInTheDocument()

      await waitFor(() => expect(sync).toBeEnabled())
      await userEvent.click(sync)
      expect(await screen.findByText("Up to date")).toBeInTheDocument()
      await waitFor(() =>
        expect(screen.queryByText("Could not sync reviews")).toBeNull()
      )
      expect(screen.getAllByText("Up to date")).toHaveLength(1)
      expect(document.querySelectorAll('[data-slot="toast"]')).toHaveLength(1)
    })

    it("replaces a success with a later failure", async () => {
      stubOutcomes([succeeded(), failed()])
      renderButton(true, 12)
      const sync = screen.getByRole("button", { name: "Sync reviews" })

      await userEvent.click(sync)
      expect(await screen.findByText("Up to date")).toBeInTheDocument()

      await waitFor(() => expect(sync).toBeEnabled())
      await userEvent.click(sync)
      expect(
        await screen.findByText("Could not sync reviews")
      ).toBeInTheDocument()
      await waitFor(() => expect(screen.queryByText("Up to date")).toBeNull())
      expect(
        screen.queryByText("Google has no reviews newer than these.")
      ).toBeNull()
      expect(document.querySelectorAll('[data-slot="toast"]')).toHaveLength(1)
      expect(document.querySelector('[data-slot="toast"]')).toHaveAttribute(
        "data-type",
        "error"
      )
    })
  })
})
