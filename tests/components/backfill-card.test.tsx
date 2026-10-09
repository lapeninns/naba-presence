import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BackfillCard } from "@/components/settings/backfill-card"
import { Toaster } from "@/components/ui/toast"
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
  options: { scope?: string[]; startError?: unknown } = {}
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
    cancel: { mutate: vi.fn(), isPending: false },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <BackfillCard externalLocationIds={options.scope} />
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
    expect(start).toHaveBeenCalledWith({
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
  it("shows the honest per-location status and a cancel action while running", () => {
    renderCard([item({})])
    expect(screen.getByText("Riverside Rooms")).toBeInTheDocument()
    expect(screen.getByText("Importing…")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Cancel import for Riverside Rooms" })
    ).toBeInTheDocument()
  })

  it("starts a backfill on click", () => {
    const start = vi.fn()
    renderCard([item({ status: "not_started" })], start)
    fireEvent.click(screen.getByRole("button", { name: "Start import" }))
    expect(start).toHaveBeenCalledWith({ maxPagesPerLocation: 10 })
  })

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
