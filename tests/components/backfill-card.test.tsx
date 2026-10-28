import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BackfillCard } from "@/components/settings/backfill-card"
import { Toaster } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"
import type { BackfillItem } from "@/lib/api/backfill"

const backfillMock = vi.fn()
vi.mock("@/lib/queries/use-backfill", () => ({
  useBackfill: () => backfillMock(),
}))

function item(overrides: Partial<BackfillItem>): BackfillItem {
  return {
    externalLocationId: "e1",
    locationName: "Riverside Rooms",
    status: "running",
    attemptCount: 1,
    hasMorePages: true,
    lastErrorCode: null,
    startedAt: "2026-08-02T00:00:00.000Z",
    finishedAt: null,
    nextAttemptAt: null,
    ...overrides,
  }
}

function renderCard(
  items: BackfillItem[],
  start = vi.fn(),
  options: {
    scope?: string[]
    startError?: unknown
    cancel?: ReturnType<typeof vi.fn>
    cancelError?: unknown
    onStartSettled?: () => void
    inFlightNote?: React.ReactNode
  } = {}
) {
  backfillMock.mockReturnValue({
    query: {
      data: { progress: { items, counts: {}, total: items.length } },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    },
    start: {
      mutate: start,
      isPending: false,
      error: options.startError ?? null,
    },
    cancel: {
      mutate: options.cancel ?? vi.fn(),
      isPending: false,
      error: options.cancelError ?? null,
    },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <BackfillCard
          externalLocationIds={options.scope}
          onStartSettled={options.onStartSettled}
          inFlightNote={options.inFlightNote}
        />
      </Toaster>
    </QueryClientProvider>
  )
}

describe("BackfillCard scoped to one client", () => {
  it("shows and imports only the client's listings", () => {
    const start = vi.fn()
    renderCard(
      [
        item({
          externalLocationId: "e1",
          locationName: "Riverside Rooms",
          status: "not_started",
        }),
        item({
          externalLocationId: "e2",
          locationName: "Other Client Inn",
          status: "not_started",
        }),
      ],
      start,
      { scope: ["e1"] }
    )
    expect(screen.getByText("Riverside Rooms")).toBeInTheDocument()
    expect(screen.queryByText("Other Client Inn")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Start import" }))
    expect(start.mock.calls[0][0]).toEqual({
      externalLocationIds: ["e1"],
      maxPagesPerLocation: 10,
    })
  })

  it("offers no import when the client has no linked listings", () => {
    renderCard([item({})], vi.fn(), { scope: [] })
    expect(screen.getByText("No linked listings yet")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Start import" })
    ).not.toBeInTheDocument()
  })

  it("says so when the import fails to start", () => {
    renderCard([item({ status: "not_started" })], vi.fn(), {
      startError: new Error("boom"),
    })
    expect(screen.getByText("The import didn’t start")).toBeInTheDocument()
  })
})

afterEach(() => vi.clearAllMocks())

describe("BackfillCard", () => {
  it("shows the honest per-location status, with no cancel once running", () => {
    renderCard([item({})])
    expect(screen.getByText("Riverside Rooms")).toBeInTheDocument()
    expect(screen.getByText("Importing…")).toBeInTheDocument()
    // The server refuses to cancel a running batch (409), so none is offered.
    expect(
      screen.queryByRole("button", { name: /Cancel import/ })
    ).not.toBeInTheDocument()
  })

  it("offers cancel on a queued row", () => {
    const cancel = vi.fn()
    renderCard([item({ status: "pending", attemptCount: 0 })], vi.fn(), {
      cancel,
    })
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel import for Riverside Rooms" })
    )
    expect(cancel).toHaveBeenCalledWith(["e1"])
  })

  it("says so when a cancel fails", () => {
    renderCard([item({ status: "pending" })], vi.fn(), {
      cancelError: new ApiClientError(
        409,
        "backfill_batch_running",
        "Batch running"
      ),
    })
    expect(
      screen.getByText("We couldn’t cancel the import")
    ).toBeInTheDocument()
  })

  it("starts a backfill on click and reports when it settles", () => {
    const start = vi.fn()
    const onStartSettled = vi.fn()
    renderCard([item({ status: "not_started" })], start, { onStartSettled })
    fireEvent.click(screen.getByRole("button", { name: "Start import" }))
    expect(start).toHaveBeenCalledWith(
      { maxPagesPerLocation: 10 },
      { onSettled: onStartSettled }
    )
  })

  it("makes Start the primary action until something imports", () => {
    renderCard([item({ status: "not_started", attemptCount: 0 })])
    const startButton = screen.getByRole("button", { name: "Start import" })
    expect(startButton).toHaveAttribute("id", "setup-backfill-start")
    expect(startButton).toHaveAttribute("data-variant", "default")
  })

  it("steps Start back once a listing has imported", () => {
    renderCard([item({ status: "succeeded", hasMorePages: false })])
    expect(
      screen.getByRole("button", { name: "Start import" })
    ).toHaveAttribute("data-variant", "secondary")
  })

  it("hides the attempt count on a row that hasn’t started", () => {
    renderCard([item({ status: "not_started", attemptCount: 0 })])
    expect(screen.queryByText("0")).not.toBeInTheDocument()
    expect(screen.getByText("No attempts yet")).toBeInTheDocument()
  })

  it("shows the in-flight note only while a listing is importing", () => {
    const note = <p>Keeps going</p>
    const { unmount } = renderCard([item({ status: "not_started" })], vi.fn(), {
      inFlightNote: note,
    })
    expect(screen.queryByText("Keeps going")).not.toBeInTheDocument()
    unmount()
    renderCard([item({ status: "running" })], vi.fn(), { inFlightNote: note })
    expect(screen.getByText("Keeps going")).toBeInTheDocument()
  })

  it.each(["failed", "dead", "cancelled"] as const)(
    "labels the button Retry import after a %s import",
    (status) => {
      renderCard([item({ status, hasMorePages: false })])
      expect(
        screen.getByRole("button", { name: "Retry import" })
      ).toBeInTheDocument()
    }
  )

  // U3: BackfillItem.lastErrorCode is fetched but must render as humanised
  // copy on a failed row — never the raw code.
  it("shows a humanised reason on a failed row, never the raw lastErrorCode", () => {
    renderCard([
      item({ status: "failed", lastErrorCode: "location_not_verified" }),
    ])
    expect(
      screen.getByText("This location is not yet verified on Google.")
    ).toBeInTheDocument()
    expect(screen.queryByText("location_not_verified")).not.toBeInTheDocument()
  })

  it("falls back to a generic honest reason for an unrecognised error code", () => {
    renderCard([item({ status: "failed", lastErrorCode: "some_new_code" })])
    expect(
      screen.getByText(
        "This import could not complete. It will retry automatically."
      )
    ).toBeInTheDocument()
    expect(screen.queryByText("some_new_code")).not.toBeInTheDocument()
  })

  it("shows no error reason for a failed row without a lastErrorCode", () => {
    renderCard([item({ status: "failed", lastErrorCode: null })])
    expect(screen.getByText("Failed")).toBeInTheDocument()
  })
})

describe("BackfillCard stopped imports", () => {
  // `dead` is terminal (lib/contracts/sync.ts): the runner never retries it,
  // so the row must not leak the raw enum or promise an automatic retry.
  it("names a stopped import and says only Retry import retries it", () => {
    renderCard([
      item({
        status: "dead",
        hasMorePages: false,
        lastErrorCode: "sync_failed",
      }),
    ])
    expect(screen.getByText("Stopped")).toBeInTheDocument()
    expect(screen.queryByText("dead")).not.toBeInTheDocument()
    expect(
      screen.getByText(
        "The import stopped after repeated failures. Use Retry import to try again."
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/retry automatically/)).not.toBeInTheDocument()
  })
})
