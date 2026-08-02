import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { LegalHoldsCard } from "@/components/settings/legal-holds-card"
import { Toaster } from "@/components/ui/toast"
import type { LegalHold } from "@/lib/api/legal-holds"

const useHoldsMock = vi.fn()
vi.mock("@/lib/queries/use-legal-holds", () => ({ useLegalHolds: () => useHoldsMock() }))

function renderCard(holds: LegalHold[]) {
  useHoldsMock.mockReturnValue({ data: { holds }, isPending: false, isError: false, refetch: vi.fn() })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <LegalHoldsCard />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("LegalHoldsCard", () => {
  it("lists an active hold with a release action", () => {
    renderCard([
      { id: "h1", reviewId: "rev-1", reason: "Litigation pending", approvedBy: "u", releasedBy: null, releasedAt: null, createdAt: "2026-08-01T00:00:00.000Z" },
    ])
    expect(screen.getByText("Litigation pending")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Release hold on rev-1" })).toBeInTheDocument()
  })
})
