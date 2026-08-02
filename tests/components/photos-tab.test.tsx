import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PhotosTab } from "@/components/locations/photos-tab"
import { Toaster } from "@/components/ui/toast"
import type { MediaState } from "@/lib/api/location-media"

const useMediaMock = vi.fn()
const useCapsMock = vi.fn()
vi.mock("@/lib/queries/use-location-media", () => ({ useMedia: () => useMediaMock() }))
vi.mock("@/lib/queries/use-location-capabilities", () => ({ useLocationCapabilities: () => useCapsMock() }))

function makeMedia(overrides: Partial<MediaState> = {}): MediaState {
  return {
    canPublish: true,
    writesEnabled: true,
    categories: ["COVER", "PROFILE", "ADDITIONAL", "INTERIOR"],
    items: [
      { id: "m1", googleMediaName: "accounts/a/locations/l/media/1", ownership: "merchant", mediaFormat: "PHOTO", category: "INTERIOR", sourceUrl: null, googleUrl: "https://g/1", thumbnailUrl: "https://g/1t", description: null, attribution: null, dimensions: null, insights: null, googleHash: "h1", createTime: "2026-07-01T00:00:00.000Z" },
      { id: "m2", googleMediaName: "accounts/a/locations/l/media/2", ownership: "customer", mediaFormat: "PHOTO", category: "ADDITIONAL", sourceUrl: null, googleUrl: "https://g/2", thumbnailUrl: "https://g/2t", description: null, attribution: null, dimensions: null, insights: null, googleHash: "h2", createTime: null },
    ],
    ...overrides,
  }
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <PhotosTab locationId="loc-1" />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("PhotosTab", () => {
  it("renders the add-media controls (e2e contract) for a publisher", () => {
    useMediaMock.mockReturnValue({ data: makeMedia(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(screen.getByText("Add media", { exact: true })).toBeInTheDocument()
    expect(screen.getByLabelText("Direct file upload")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Review file upload" })).toBeDisabled()
    expect(screen.getByText("Customer photo")).toBeInTheDocument()
  })

  it("disables add controls with a reason when writes are paused", () => {
    useMediaMock.mockReturnValue({ data: makeMedia({ writesEnabled: false }), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: false, canPublish: false } })
    renderTab()
    expect(screen.getByRole("button", { name: "Add from URL" })).toBeDisabled()
    expect(screen.getByText("You do not have permission to publish this location to Google.")).toBeInTheDocument()
  })

  // U5: the tab always sends mediaFormat: "PHOTO" (both the URL and file-upload
  // mutations), so the file picker must not offer video — it would always be
  // rejected.
  it("restricts the file picker's accept to images only, never video", () => {
    useMediaMock.mockReturnValue({ data: makeMedia(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    const input = screen.getByLabelText("Direct file upload")
    expect(input).toHaveAttribute("accept", "image/jpeg,image/png")
    expect(input.getAttribute("accept")).not.toMatch(/video/)
  })
})
