import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PrivacyRequestsCard } from "@/components/settings/privacy-requests-card"
import { Toaster } from "@/components/ui/toast"
import type { PrivacyRequest } from "@/lib/api/privacy"

const useRequestsMock = vi.fn()
vi.mock("@/lib/queries/use-privacy-requests", () => ({ usePrivacyRequests: () => useRequestsMock() }))

function request(overrides: Partial<PrivacyRequest>): PrivacyRequest {
  return {
    id: "r1",
    requestType: "erasure",
    status: "pending",
    subjectReference: "guest-4821",
    reason: null,
    requestedBy: "u",
    resolvedBy: null,
    resolutionNote: null,
    resolvedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  }
}

function renderCard(requests: PrivacyRequest[]) {
  useRequestsMock.mockReturnValue({ data: { requests }, isPending: false, isError: false, refetch: vi.fn() })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <PrivacyRequestsCard canManage />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("PrivacyRequestsCard", () => {
  it("lists a request with a humanised type and status", () => {
    renderCard([request({})])
    expect(screen.getByText("guest-4821")).toBeInTheDocument()
    expect(screen.getByText("Erasure")).toBeInTheDocument()
    expect(screen.getByText("Pending")).toBeInTheDocument()
  })

  it("renders the create form", () => {
    renderCard([])
    expect(screen.getByRole("textbox", { name: "Subject reference" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Log request" })).toBeInTheDocument()
  })
})
