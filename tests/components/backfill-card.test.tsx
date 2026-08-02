import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BackfillCard } from "@/components/settings/backfill-card"
import { Toaster } from "@/components/ui/toast"
import type { BackfillItem } from "@/lib/api/backfill"

const backfillMock = vi.fn()
vi.mock("@/lib/queries/use-backfill", () => ({ useBackfill: () => backfillMock() }))

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

function renderCard(items: BackfillItem[], start = vi.fn()) {
  backfillMock.mockReturnValue({
    query: { data: { progress: { items, counts: {}, total: items.length } }, isPending: false, isError: false, refetch: vi.fn() },
    start: { mutate: start, isPending: false, error: null },
    cancel: { mutate: vi.fn(), isPending: false },
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <BackfillCard />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("BackfillCard", () => {
  it("shows the honest per-location status and a cancel action while running", () => {
    renderCard([item({})])
    expect(screen.getByText("Riverside Rooms")).toBeInTheDocument()
    expect(screen.getByText("Syncing…")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cancel sync for Riverside Rooms" })).toBeInTheDocument()
  })

  it("starts a backfill on click", () => {
    const start = vi.fn()
    renderCard([item({ status: "not_started" })], start)
    fireEvent.click(screen.getByRole("button", { name: "Start sync" }))
    expect(start).toHaveBeenCalledWith({ maxPagesPerLocation: 10 })
  })
})
