import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PhotosTab } from "@/components/locations/photos-tab"
import { Toaster } from "@/components/ui/toast"
import type { MediaState } from "@/lib/api/location-media"
import { isPatchableMediaCategory } from "@/lib/locations/media-labels"
import type { ListPaging } from "@/lib/queries/paged-list"

const useMediaMock = vi.fn()
const useCapsMock = vi.fn()
const updateMediaCategoryMock = vi.fn()
const resolveMediaCreateMock = vi.fn()
const replace = vi.fn()
// The tab reads its filters from the URL; each test seeds this before render.
let searchParams = new URLSearchParams()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => "/locations/loc-1/photos",
  useSearchParams: () => searchParams,
}))

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
    resolveMediaCreate: (...args: unknown[]) => resolveMediaCreateMock(...args),
    fetchMedia: vi.fn(),
  }
})

type MediaView = MediaState & { paging: ListPaging }
const noMore: ListPaging = {
  hasMore: false,
  loadingMore: false,
  loadMoreFailed: false,
  loadMore: () => {},
}

function makeMedia(overrides: Partial<MediaView> = {}): MediaView {
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
    pageSize: 12,
    nextCursor: null,
    category: null,
    ownership: null,
    unresolvedCreates: [],
    paging: noMore,
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
  searchParams = new URLSearchParams()
})

function loaded(media: MediaView) {
  useMediaMock.mockReturnValue({
    data: media,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  })
  useCapsMock.mockReturnValue({
    data: { canEditCanonical: true, canPublish: true },
  })
}

function manyItems(count: number) {
  return Array.from({ length: count }, (_, index) => ({
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
}

describe("PhotosTab", () => {
  it("asks a publisher to resolve an upload Google never confirmed", async () => {
    const user = userEvent.setup()
    resolveMediaCreateMock.mockResolvedValue({
      id: "attempt-1",
      status: "failed",
      idempotent: false,
    })
    loaded(
      makeMedia({
        unresolvedCreates: [
          {
            attemptId: "attempt-1",
            mediaFormat: "PHOTO",
            category: "FOOD_AND_DRINK",
            description: null,
            fileName: "dish.jpg",
            sourceUrl: null,
            startedAt: new Date().toISOString(),
          },
        ],
      })
    )
    renderTab()
    expect(
      screen.getByText("Google did not confirm an upload")
    ).toBeInTheDocument()
    expect(screen.getByText(/“dish\.jpg”/)).toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: "It is not on Google" })
    )
    expect(resolveMediaCreateMock).toHaveBeenCalledWith(
      "loc-1",
      "attempt-1",
      "abandoned"
    )
  })

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
    // The area header above owns the visible title, status and model note;
    // the frame keeps its heading for the outline only and repeats no pill.
    expect(screen.getByRole("heading", { name: "Photo library" })).toHaveClass(
      "sr-only"
    )
    expect(screen.queryByText(/on Google$/)).toBeNull()
    expect(screen.queryByText(/There is no draft step/)).toBeNull()
    await user.click(screen.getByRole("button", { name: "Add photos" }))
    // The dialog loads the first time it opens.
    expect(
      await screen.findByRole("heading", { name: "Add media" })
    ).toBeInTheDocument()
    // Two explicit ways in on a phone: the camera and the library.
    expect(
      screen.getByRole("button", { name: "Take photo" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Choose from library" })
    ).toBeInTheDocument()
    expect(screen.getByLabelText("Direct file upload")).toBeInTheDocument()
    expect(
      screen.getByLabelText("Take a photo with the camera")
    ).toHaveAttribute("capture", "environment")
    expect(
      screen.getByText(/JPEG or PNG only \(not HEIC\)/)
    ).toBeInTheDocument()
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
    const input = await screen.findByLabelText("Direct file upload")
    expect(input).toHaveAttribute("accept", "image/jpeg,image/png")
    expect(input.getAttribute("accept")).not.toMatch(/video/)
  })

  it("shows a thumbnail per file, announces only a summary and releases the previews", async () => {
    const user = userEvent.setup()
    const createObjectURL = vi.fn(() => "blob:preview-1")
    const revokeObjectURL = vi.fn()
    // jsdom has no object URLs; lend it a pair for this test only.
    Object.assign(URL, { createObjectURL, revokeObjectURL })
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
    const photo = new File([new Uint8Array(20 * 1024)], "bar.jpg", {
      type: "image/jpeg",
    })
    const tiny = new File([new Uint8Array(100)], "tiny.png", {
      type: "image/png",
    })
    await user.upload(screen.getByLabelText("Direct file upload"), [
      photo,
      tiny,
    ])

    const list = screen.getByRole("list", { name: "Files to upload" })
    expect(list).not.toHaveAttribute("aria-live")
    expect(list.querySelector('img[src="blob:preview-1"]')).not.toBeNull()
    expect(
      screen.getByText(/Google needs photos of at least 10 KB/)
    ).toBeInTheDocument()
    expect(
      screen.getByText("0 sent, 1 ready, 1 can’t upload.")
    ).toBeInTheDocument()

    // The upload confirmation is a second step of the same dialog, never a
    // dialog stacked on top of it.
    await user.click(screen.getByRole("button", { name: "Review file upload" }))
    expect(screen.queryByRole("alertdialog")).toBeNull()
    const confirm = screen.getByRole("dialog", {
      name: "Upload this file to Google?",
    })
    expect(within(confirm).getByText(/under “Additional”/)).toBeInTheDocument()
    expect(
      within(confirm).getByRole("img", { name: "bar.jpg" })
    ).toBeInTheDocument()
    expect(
      within(confirm).getByRole("button", { name: "Upload 1 photo" })
    ).toBeInTheDocument()
    await user.click(within(confirm).getByRole("button", { name: "Back" }))

    await user.click(screen.getByRole("button", { name: "Remove bar.jpg" }))
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview-1")
    Reflect.deleteProperty(URL, "createObjectURL")
    Reflect.deleteProperty(URL, "revokeObjectURL")
  })

  it("names HEIC as unsupported and asks before a stray dismissal drops chosen files", async () => {
    const user = userEvent.setup({ applyAccept: false })
    loaded(makeMedia())
    renderTab()
    await user.click(screen.getByRole("button", { name: "Add photos" }))
    const heic = new File([new Uint8Array(20 * 1024)], "IMG_0001.HEIC", {
      type: "image/heic",
    })
    const photo = new File([new Uint8Array(20 * 1024)], "bar.jpg", {
      type: "image/jpeg",
    })
    await user.upload(screen.getByLabelText("Direct file upload"), [
      heic,
      photo,
    ])
    expect(screen.getByText(/HEIC photos aren’t supported/)).toBeInTheDocument()

    await user.keyboard("{Escape}")
    const prompt = await screen.findByRole("alertdialog", {
      name: "Discard these photos?",
    })
    await user.click(
      within(prompt).getByRole("button", { name: "Keep editing" })
    )
    expect(screen.getByText("bar.jpg")).toBeInTheDocument()
  })

  it("shows a page of media and loads more on request, announcing the count", async () => {
    const user = userEvent.setup()
    const loadMore = vi.fn()
    loaded(
      makeMedia({
        items: manyItems(12),
        total: 15,
        paging: { ...noMore, hasMore: true, loadMore },
      })
    )
    renderTab()
    expect(
      screen.getAllByRole("button", { name: /^Preview Additional photo$/ })
    ).toHaveLength(12)
    expect(screen.getByText("Showing 12 of 15 items")).toHaveAttribute(
      "role",
      "status"
    )
    await user.click(screen.getByRole("button", { name: "Load more items" }))
    expect(loadMore).toHaveBeenCalledTimes(1)
  })

  it("keeps the loaded media and says so when loading more fails", () => {
    loaded(
      makeMedia({
        items: manyItems(12),
        total: 15,
        paging: { ...noMore, hasMore: true, loadMoreFailed: true },
      })
    )
    renderTab()
    expect(
      screen.getAllByRole("button", { name: /^Preview Additional photo$/ })
    ).toHaveLength(12)
    expect(screen.getByRole("alert")).toHaveTextContent(
      "We couldn’t load more items. Try again."
    )
    expect(
      screen.getByRole("button", { name: "Load more items" })
    ).toBeInTheDocument()
  })

  it("offers no Load more once everything is shown", () => {
    loaded(makeMedia({ items: manyItems(3), total: 3 }))
    renderTab()
    expect(screen.getByText("Showing all 3 items")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Load more/ })).toBeNull()
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
    // Three options choosing one value: radio semantics, not a tablist
    // without panels.
    const ownership = screen.getByRole("radiogroup", {
      name: "Photo ownership",
    })
    expect(screen.queryByRole("tablist")).toBeNull()
    expect(
      within(ownership).getByRole("radio", { name: "Your photos" })
    ).toBeInTheDocument()
    expect(
      within(ownership).getByRole("radio", { name: "Customer photos" })
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

    expect(updateMediaCategoryMock).toHaveBeenCalledWith(
      "loc-1",
      "m1",
      { category: "EXTERIOR", expectedGoogleHash: "h1" },
      { intentId: expect.any(String) }
    )
  })

  it("treats cover and profile as create-only categories", () => {
    expect(isPatchableMediaCategory("COVER")).toBe(false)
    expect(isPatchableMediaCategory("PROFILE")).toBe(false)
    expect(isPatchableMediaCategory("INTERIOR")).toBe(true)
  })

  // Sprint 4.2c: browse filters live in the URL so a filtered view survives
  // reload and sharing; defaults are dropped so the plain photos URL stays
  // canonical. Paging is by cursor, so a `page` left in an old link is
  // dropped on the next change.
  it("writes an ownership filter to the URL with replace and drops an old page", async () => {
    const user = userEvent.setup()
    searchParams = new URLSearchParams("page=2")
    loaded(makeMedia({ items: manyItems(12), total: 15 }))
    renderTab()

    await user.click(screen.getByRole("radio", { name: "Customer photos" }))
    expect(replace).toHaveBeenCalledWith(
      "/locations/loc-1/photos?ownership=customer",
      { scroll: false }
    )
  })

  it("reflects the URL's filters as pressed and clears them back to the bare URL", async () => {
    const user = userEvent.setup()
    searchParams = new URLSearchParams(
      "ownership=customer&category=INTERIOR&page=3"
    )
    loaded(makeMedia({ items: [], total: 0 }))
    renderTab()
    expect(screen.getByRole("radio", { name: "Customer photos" })).toBeChecked()
    expect(screen.getByRole("radio", { name: "All" })).not.toBeChecked()
    expect(screen.getByText("No matching photos")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Clear filters" }))
    expect(replace).toHaveBeenCalledWith("/locations/loc-1/photos", {
      scroll: false,
    })
  })
})
