import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  isPatchableMediaCategory,
  PhotosTab,
} from "@/components/locations/photos-tab"
import { Toaster } from "@/components/ui/toast"
import type { MediaState } from "@/lib/api/location-media"

const useMediaMock = vi.fn()
const useCapsMock = vi.fn()
const updateMediaCategoryMock = vi.fn()

vi.mock("@/lib/queries/use-location-media", () => ({
  useMedia: () => useMediaMock(),
}))
vi.mock("@/lib/queries/use-location-capabilities", () => ({
  useLocationCapabilities: () => useCapsMock(),
}))
vi.mock("@/lib/api/location-media", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/location-media")
  >("@/lib/api/location-media")
  return {
    ...actual,
    updateMediaCategory: (...args: unknown[]) =>
      updateMediaCategoryMock(...args),
    fetchMedia: vi.fn(),
  }
})

function makeMedia(overrides: Partial<MediaState> = {}): MediaState {
  const items = overrides.items ?? [
    {
      id: "m1",
      googleMediaName: "accounts/a/locations/l/media/1",
      ownership: "merchant",
      mediaFormat: "PHOTO",
      category: "INTERIOR",
      sourceUrl: null,
      googleUrl: "https://g/1",
      thumbnailUrl: "https://g/1t",
      description: null,
      attribution: null,
      dimensions: null,
      insights: null,
      googleHash: "h1",
      createTime: "2026-07-01T00:00:00.000Z",
    },
    {
      id: "m2",
      googleMediaName: "accounts/a/locations/l/media/2",
      ownership: "customer",
      mediaFormat: "PHOTO",
      category: "ADDITIONAL",
      sourceUrl: null,
      googleUrl: "https://g/2",
      thumbnailUrl: "https://g/2t",
      description: null,
      attribution: null,
      dimensions: null,
      insights: null,
      googleHash: "h2",
      createTime: null,
    },
  ]
  const { total: overrideTotal, ...rest } = overrides
  return {
    canPublish: true,
    writesEnabled: true,
    categories: ["COVER", "PROFILE", "ADDITIONAL", "INTERIOR", "EXTERIOR"],
    page: 1,
    pageSize: 12,
    category: null,
    ownership: null,
    ...rest,
    items,
    total: overrideTotal ?? items.length,
  }
}

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <PhotosTab locationId="loc-1" />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.clearAllMocks()
})

describe("PhotosTab", () => {
  it("opens the redesigned add-media workspace for a publisher", async () => {
    const user = userEvent.setup()
    useMediaMock.mockReturnValue({
      data: makeMedia(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    expect(screen.getByText("Photo library")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Add photos" }))
    expect(
      screen.getByRole("heading", { name: "Add media" })
    ).toBeInTheDocument()
    expect(screen.getByLabelText("Direct file upload")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Review file upload" })
    ).toBeDisabled()
    expect(screen.getByText("Shared by a customer")).toBeInTheDocument()
  })

  it("omits the localhost referrer when loading Google thumbnails", () => {
    useMediaMock.mockReturnValue({
      data: makeMedia(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })

    const { container } = renderTab()
    const thumbnail = container.querySelector("img")

    expect(thumbnail).toHaveAttribute("referrerpolicy", "no-referrer")
  })

  it("opens a media preview from a gallery card", async () => {
    const user = userEvent.setup()
    useMediaMock.mockReturnValue({
      data: makeMedia(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })

    renderTab()
    await user.click(
      screen.getByRole("button", { name: "Preview Interior photo" })
    )

    expect(
      screen.getByRole("heading", { name: "Interior" })
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Open original" })).toHaveAttribute(
      "href",
      "https://g/1"
    )
  })

  it("disables add controls with a reason when writes are paused", () => {
    useMediaMock.mockReturnValue({
      data: makeMedia({ writesEnabled: false }),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: false, canPublish: false },
    })
    renderTab()
    expect(screen.getByRole("button", { name: "Add photos" })).toBeDisabled()
    expect(
      screen.getByText(
        "You do not have permission to publish this location to Google."
      )
    ).toBeInTheDocument()
  })

  // U5: the tab always sends mediaFormat: "PHOTO" (both the URL and file-upload
  // mutations), so the file picker must not offer video — it would always be
  // rejected.
  it("restricts the file picker's accept to images only, never video", async () => {
    const user = userEvent.setup()
    useMediaMock.mockReturnValue({
      data: makeMedia(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    await user.click(screen.getByRole("button", { name: "Add photos" }))
    const input = screen.getByLabelText("Direct file upload")
    expect(input).toHaveAttribute("accept", "image/jpeg,image/png")
    expect(input.getAttribute("accept")).not.toMatch(/video/)
  })

  it("paginates current media instead of rendering every image at once", () => {
    const items = Array.from({ length: 15 }, (_, index) => ({
      id: `m${index}`,
      googleMediaName: `accounts/a/locations/l/media/${index}`,
      ownership: "merchant" as const,
      mediaFormat: "PHOTO",
      category: "ADDITIONAL",
      sourceUrl: null,
      googleUrl: `https://g/${index}`,
      thumbnailUrl: `https://g/${index}t`,
      description: null,
      attribution: null,
      dimensions: null,
      insights: null,
      googleHash: `h${index}`,
      createTime: "2026-07-01T00:00:00.000Z",
    }))
    useMediaMock.mockReturnValue({
      data: makeMedia({
        items: items.slice(0, 12),
        total: 15,
        page: 1,
        pageSize: 12,
      }),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    expect(
      screen.getAllByRole("button", { name: /^Preview Additional photo$/ })
    ).toHaveLength(12)
    expect(screen.getByText("1–12 of 15 · Page 1 of 2")).toBeInTheDocument()
    expect(
      screen.getByRole("navigation", { name: "Photo pages" })
    ).toBeInTheDocument()
  })

  it("shows ownership and category browse filters", () => {
    useMediaMock.mockReturnValue({
      data: makeMedia(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    expect(
      screen.getByRole("group", { name: "Photo ownership" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Your photos" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Customer photos" })
    ).toBeInTheDocument()
    expect(screen.getByLabelText("Filter by category")).toBeInTheDocument()
  })

  it("lets merchants change category but keeps customer photos read-only", async () => {
    const user = userEvent.setup()
    updateMediaCategoryMock.mockResolvedValue({
      id: "m1",
      status: "succeeded",
      idempotent: false,
    })
    useMediaMock.mockReturnValue({
      data: makeMedia(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()

    expect(
      screen.getByLabelText("Change category for Interior photo")
    ).toBeInTheDocument()
    expect(
      screen.queryByLabelText("Change category for Additional photo")
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Delete Interior photo" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Delete Additional photo" })
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByLabelText("Change category for Interior photo")
    )
    const listbox = await screen.findByRole("listbox")
    expect(within(listbox).queryByText("Cover")).not.toBeInTheDocument()
    expect(within(listbox).queryByText("Profile")).not.toBeInTheDocument()
    await user.click(within(listbox).getByText("Exterior"))

    expect(updateMediaCategoryMock).toHaveBeenCalledWith("loc-1", "m1", {
      category: "EXTERIOR",
      expectedGoogleHash: "h1",
    })
  })

  it("treats cover and profile as create-only categories", () => {
    expect(isPatchableMediaCategory("COVER")).toBe(false)
    expect(isPatchableMediaCategory("PROFILE")).toBe(false)
    expect(isPatchableMediaCategory("INTERIOR")).toBe(true)
  })
})
