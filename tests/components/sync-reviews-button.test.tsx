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

  it("says up to date only for the listings it checked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) =>
        String(input).startsWith("/api/reviews/counts")
          ? json(counts(12))
          : json({
              processed: 1,
              nextCursor: null,
              failures: [],
              locations: [{ externalLocationId: "loc-a", status: "succeeded" }],
            })
      )
    )
    renderButton(true, 12)
    await userEvent.click(screen.getByRole("button", { name: "Sync reviews" }))
    expect(await screen.findByText("Up to date")).toBeInTheDocument()
    expect(
      screen.getByText("Google has no newer reviews for the listings checked.")
    ).toBeInTheDocument()
  })

  it.each([
    [
      "nothing new",
      12,
      "No new reviews so far",
      "Google had more reviews than this sync could read for 1 listing. Scheduled checks keep running.",
    ],
    [
      "some new",
      14,
      "2 new reviews",
      "Added to your Inbox. Google had more reviews than this sync could read for 1 listing. Scheduled checks keep running.",
    ],
  ])(
    "never says up to date when a listing was only partly read (%s)",
    async (_case, after, title, description) => {
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (input) =>
          String(input).startsWith("/api/reviews/counts")
            ? json(counts(after))
            : json({
                processed: 1,
                nextCursor: null,
                failures: [],
                locations: [
                  { externalLocationId: "loc-a", status: "succeeded" },
                  { externalLocationId: "loc-b", status: "partial" },
                ],
              })
        )
      )
      renderButton(true, 12)
      await userEvent.click(
        screen.getByRole("button", { name: "Sync reviews" })
      )
      expect(await screen.findByText(title)).toBeInTheDocument()
      expect(screen.getByText(description)).toBeInTheDocument()
      expect(screen.queryByText("Up to date")).toBeNull()
      expect(document.querySelector('[data-slot="toast"]')).toHaveAttribute(
        "data-type",
        "info"
      )
    }
  )

  it("says a partly read sync was partly synced when the counts can't be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        json({
          processed: 1,
          nextCursor: null,
          failures: [],
          locations: [
            { externalLocationId: "loc-a", status: "partial" },
            { externalLocationId: "loc-b", status: "partial" },
          ],
        })
      )
    )
    // No total before: what was added can't be told.
    renderButton(true)
    await userEvent.click(screen.getByRole("button", { name: "Sync reviews" }))
    expect(await screen.findByText("Reviews partly synced")).toBeInTheDocument()
    expect(
      screen.getByText(
        "Google had more reviews than this sync could read for 2 listings. Scheduled checks keep running."
      )
    ).toBeInTheDocument()
  })

  it("says when a sync is already running, as news rather than an error", async () => {
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
        "A check that started a moment ago is still running. Sync again in a minute to see what it found."
      )
    ).toBeInTheDocument()
    expect(screen.getByText("Already checking Google")).toBeInTheDocument()
    expect(screen.queryByText("Could not sync reviews")).toBeNull()
    expect(document.querySelector('[data-slot="toast"]')).toHaveAttribute(
      "data-type",
      "info"
    )
    // The check is running: pressing again now would only be skipped too.
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Sync reviews" })).toBeEnabled()
  })

  it("reports a failed sync as a toast, with Try again", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json({ error: "internal_error", message: "x" }, 500)
    )
    vi.stubGlobal("fetch", fetchMock)
    renderButton(true)
    await userEvent.click(screen.getByRole("button", { name: "Sync reviews" }))
    expect(
      await screen.findByText("Could not sync reviews")
    ).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    // A second press, never sent by itself: only when it is pressed.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it("shows its progress in the toast the result replaces", async () => {
    let answer: (response: Response) => void = () => {}
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>((input) =>
        String(input).startsWith("/api/reviews/counts")
          ? Promise.resolve(json(counts(12)))
          : new Promise<Response>((resolve) => {
              answer = resolve
            })
      )
    )
    renderButton(true, 12)
    await userEvent.click(screen.getByRole("button", { name: "Sync reviews" }))
    expect(
      await screen.findByText("Checking Google for new reviews…")
    ).toBeInTheDocument()
    expect(document.querySelector('[data-slot="toast"]')).toHaveAttribute(
      "data-phase",
      "progress"
    )
    answer(json({ processed: 1, nextCursor: null, failures: [] }))
    expect(await screen.findByText("Up to date")).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByText("Checking Google for new reviews…")).toBeNull()
    )
    expect(document.querySelectorAll('[data-slot="toast"]')).toHaveLength(1)
    expect(document.querySelector('[data-slot="toast"]')).toHaveAttribute(
      "data-phase",
      "result"
    )
  })

  it("says which listings could not be checked when the others were", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) =>
        String(input).startsWith("/api/reviews/counts")
          ? json(counts(12))
          : json({
              processed: 1,
              nextCursor: null,
              failures: [
                {
                  externalLocationId: "loc-b",
                  errorCode: "location_not_verified",
                },
              ],
              locations: [
                { externalLocationId: "loc-a", status: "succeeded" },
                { externalLocationId: "loc-b", status: "failed" },
              ],
            })
      )
    )
    renderButton(true, 12)
    await userEvent.click(screen.getByRole("button", { name: "Sync reviews" }))
    expect(await screen.findByText("Up to date")).toBeInTheDocument()
    expect(
      screen.getByText(
        "Google has no newer reviews for the listings checked. 1 of 2 listings couldn’t be checked. Google hasn’t verified a listing yet."
      )
    ).toBeInTheDocument()
    expect(screen.queryByText("Could not sync reviews")).toBeNull()
    expect(document.querySelector('[data-slot="toast"]')).toHaveAttribute(
      "data-type",
      "warning"
    )
    // Pressing again would not verify the listing.
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
  })

  it("says how long to wait when syncs are rate limited, with no Try again", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        json(
          {
            error: "sync_rate_limited",
            message: "x",
            details: { retryAfter: 200 },
          },
          429
        )
      )
    )
    renderButton(true)
    await userEvent.click(screen.getByRole("button", { name: "Sync reviews" }))
    expect(
      await screen.findByText(
        "You’ve synced several times in the last few minutes. Scheduled checks keep running; try again in 4 min."
      )
    ).toBeInTheDocument()
    expect(screen.getByText("Could not sync reviews")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
  })

  it("offers no Try again for a refusal a retry cannot fix", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        json({ error: "sync_paused", message: "x" }, 503)
      )
    )
    renderButton(true)
    await userEvent.click(screen.getByRole("button", { name: "Sync reviews" }))
    expect(
      await screen.findByText(
        "Syncing with Google is paused right now. Try again shortly."
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
  })

  it("says a sync with no answer may still be finishing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () => new Response("Gateway Timeout", { status: 504 })
      )
    )
    renderButton(true)
    await userEvent.click(screen.getByRole("button", { name: "Sync reviews" }))
    expect(
      await screen.findByText("Check may still be finishing")
    ).toBeInTheDocument()
    expect(screen.queryByText("Could not sync reviews")).toBeNull()
    expect(document.querySelector('[data-slot="toast"]')).toHaveAttribute(
      "data-type",
      "warning"
    )
    expect(
      screen.getByRole("button", { name: "Try again" })
    ).toBeInTheDocument()
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
            : (queue.shift() ?? json({ error: "internal_error" }, 500))
        )
      )
    }
    const skipped = () =>
      json({ skipped: true, processed: 0, nextCursor: null, failures: [] })
    const succeeded = () =>
      json({ processed: 1, nextCursor: null, failures: [] })
    const failed = () => json({ error: "internal_error" }, 500)

    it("replaces a skipped sync's toast with the retry's success", async () => {
      stubOutcomes([skipped(), succeeded()])
      renderButton(true, 12)
      const sync = screen.getByRole("button", { name: "Sync reviews" })

      await userEvent.click(sync)
      expect(
        await screen.findByText("Already checking Google")
      ).toBeInTheDocument()

      await waitFor(() => expect(sync).toBeEnabled())
      await userEvent.click(sync)
      expect(await screen.findByText("Up to date")).toBeInTheDocument()
      await waitFor(() =>
        expect(screen.queryByText("Already checking Google")).toBeNull()
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
        screen.queryByText(
          "Google has no newer reviews for the listings checked."
        )
      ).toBeNull()
      expect(document.querySelectorAll('[data-slot="toast"]')).toHaveLength(1)
      expect(document.querySelector('[data-slot="toast"]')).toHaveAttribute(
        "data-type",
        "error"
      )
    })
  })
})
