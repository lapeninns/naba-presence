import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { StepBackfill } from "@/components/setup/step-backfill"
import { Toaster } from "@/components/ui/toast"
import type { BackfillItem } from "@/lib/api/backfill"

const backfillMock = vi.fn()
vi.mock("@/lib/queries/use-backfill", () => ({
  useBackfill: () => backfillMock(),
}))
vi.mock("@/lib/queries/use-locations", () => ({
  useLocationDirectory: () => ({
    data: [{ clientId: "cl1", linked: true, externalLocationId: "e1" }],
    isPending: false,
    isError: false,
  }),
}))

function item(overrides: Partial<BackfillItem>): BackfillItem {
  return {
    externalLocationId: "e1",
    locationName: "Riverside Rooms",
    status: "not_started",
    attemptCount: 0,
    hasMorePages: false,
    lastErrorCode: null,
    startedAt: null,
    finishedAt: null,
    nextAttemptAt: null,
    ...overrides,
  }
}

function renderStep(items: BackfillItem[], start = vi.fn()) {
  backfillMock.mockReturnValue({
    query: {
      data: { progress: { items, counts: {}, total: items.length } },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    },
    start: { mutate: start, isPending: false, error: null },
    cancel: { mutate: vi.fn(), isPending: false, error: null },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const invalidate = vi.spyOn(client, "invalidateQueries")
  render(
    <QueryClientProvider client={client}>
      <Toaster>
        <StepBackfill clientId="cl1" clientName="Riverside" business={false} />
      </Toaster>
    </QueryClientProvider>
  )
  return { invalidate }
}

afterEach(() => vi.clearAllMocks())

describe("StepBackfill", () => {
  it("re-reads setup once Start has its answer, so the footer can clear", () => {
    const start = vi.fn(
      (_input: unknown, options?: { onSettled?: () => void }) =>
        options?.onSettled?.()
    )
    const { invalidate } = renderStep([item({})], start)
    expect(invalidate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Start import" }))
    expect(start.mock.calls[0][0]).toEqual({
      externalLocationIds: ["e1"],
      maxPagesPerLocation: 10,
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["clients", "cl1", "setup"],
    })
  })

  it("says the import keeps going only once something is in flight", () => {
    renderStep([item({})])
    expect(screen.queryByText(/keeps going/)).not.toBeInTheDocument()
  })

  it("says the import keeps going while it runs", () => {
    renderStep([item({ status: "running", attemptCount: 1 })])
    expect(
      screen.getByText(
        "The import keeps going if you move on. Riverside’s client page shows whether it is still running."
      )
    ).toBeInTheDocument()
  })
})
