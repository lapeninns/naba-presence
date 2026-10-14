import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SavedVerificationWorkflows } from "@/components/locations/administration/verification-saved-workflows"
import type { VerificationWorkflowItem } from "@/lib/contracts/google-verification-workflows"

vi.mock("@/lib/api/google-verification-workflows", () => ({
  fetchGoogleVerificationWorkflows: vi.fn(() => new Promise(() => {})),
}))

const NOW = new Date("2026-10-14T12:00:00.000Z").getTime()

function item(n: number, expiresInMs: number): VerificationWorkflowItem {
  return {
    reviewId: `00000000-0000-4000-8000-00000000000${n}`,
    createdAt: new Date(NOW - 60_000).toISOString(),
    operation: "start_verification",
    method: "EMAIL",
    payloadHash: "a".repeat(64),
    requestedBy: "00000000-0000-4000-8000-0000000000aa",
    approvedBy: "00000000-0000-4000-8000-0000000000bb",
    requiresSecondApprover: false,
    expiresAt: new Date(NOW + expiresInMs).toISOString(),
    canApprove: true,
    reviewReason: null,
    attempt: null,
  }
}

afterEach(() => vi.useRealTimers())

describe("SavedVerificationWorkflows deadlines", () => {
  it("marks each saved approval expired as its own deadline passes", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
    vi.setSystemTime(NOW)
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    })
    client.setQueryData(["verification-workflows", "loc-1", "start"], {
      pages: [{ workflows: [item(1, 60_000), item(2, 120_000)], nextCursor: null }],
      pageParams: [""],
    })
    render(
      <QueryClientProvider client={client}>
        <SavedVerificationWorkflows locationId="loc-1" busy={false} onSelect={() => {}} />
      </QueryClientProvider>
    )
    expect(screen.getAllByText(/Approved review/)).toHaveLength(2)
    expect(screen.queryByText(/Approval expired/)).toBeNull()

    act(() => vi.advanceTimersByTime(60_001))
    expect(screen.getAllByText(/Approval expired/)).toHaveLength(1)
    expect(screen.getAllByText(/Approved review/)).toHaveLength(1)

    // The second deadline has a timer of its own once the first has fired.
    act(() => vi.advanceTimersByTime(60_000))
    expect(screen.getAllByText(/Approval expired/)).toHaveLength(2)
    expect(screen.queryByText(/Approved review/)).toBeNull()
  })
})
