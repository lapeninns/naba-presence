import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PhotosTab } from "@/components/locations/photos-tab"
import { Toaster } from "@/components/ui/toast"
import { ApiClientError, MFA_STEP_UP_EVENT } from "@/lib/api/client"
import type { MediaItem, MediaState } from "@/lib/api/location-media"
import type { ListPaging } from "@/lib/queries/paged-list"

// The photos flows (p4-F01 browse, F02 add, F03 delete): what the person
// sees and hears around each request, with the requests themselves mocked
// at the lib/api boundary so their arguments (intent, hash, category) can be
// checked.

const useMediaMock = vi.fn()
const useCapsMock = vi.fn()
const fetchMediaMock = vi.fn()
const updateMediaCategoryMock = vi.fn()
const resolveMediaCreateMock = vi.fn()
const uploadMediaFileMock = vi.fn()
const createMediaFromUrlMock = vi.fn()
const deleteMediaItemMock = vi.fn()
let searchParams = new URLSearchParams()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
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
    fetchMedia: (...args: unknown[]) => fetchMediaMock(...args),
    updateMediaCategory: (...args: unknown[]) =>
      updateMediaCategoryMock(...args),
    resolveMediaCreate: (...args: unknown[]) => resolveMediaCreateMock(...args),
    uploadMediaFile: (...args: unknown[]) => uploadMediaFileMock(...args),
    createMediaFromUrl: (...args: unknown[]) => createMediaFromUrlMock(...args),
    deleteMediaItem: (...args: unknown[]) => deleteMediaItemMock(...args),
  }
})

type MediaView = MediaState & { paging: ListPaging }
const noMore: ListPaging = {
  hasMore: false,
  loadingMore: false,
  loadMoreFailed: false,
  loadMore: () => {},
}

function photo(index: number, overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: `m${index}`,
    googleMediaName: `accounts/a/locations/l/media/${index}`,
    ownership: "merchant",
    mediaFormat: "PHOTO",
    category: "INTERIOR",
    sourceUrl: null,
    googleUrl: `https://g/${index}`,
    thumbnailUrl: `https://g/${index}t`,
    description: null,
    attribution: null,
    dimensions: null,
    insights: null,
    googleHash: `h${index}`,
    createTime: "2026-07-01T00:00:00.000Z",
    ...overrides,
  }
}

function makeMedia(overrides: Partial<MediaView> = {}): MediaView {
  const items = overrides.items ?? [photo(0), photo(1), photo(2)]
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
    total: items.length,
    ...overrides,
    items,
  }
}

function loaded(media: MediaView, { canPublish = true } = {}) {
  useMediaMock.mockReturnValue({
    data: media,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  })
  useCapsMock.mockReturnValue({
    data: { canEditCanonical: canPublish, canPublish },
  })
}

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const ui = () => (
    <QueryClientProvider client={client}>
      <Toaster>
        <PhotosTab locationId="loc-1" />
      </Toaster>
    </QueryClientProvider>
  )
  const result = render(ui())
  return { ...result, rerender: () => result.rerender(ui()) }
}

function jpeg(name: string) {
  return new File([new Uint8Array(20 * 1024)], name, { type: "image/jpeg" })
}

async function openAddWith(
  user: ReturnType<typeof userEvent.setup>,
  files: File[]
) {
  await user.click(screen.getByRole("button", { name: "Add photos" }))
  await user.upload(await screen.findByLabelText("Direct file upload"), files)
}

const sentAnswer = { id: "a1", status: "succeeded", idempotent: false }

afterEach(() => {
  vi.clearAllMocks()
  searchParams = new URLSearchParams()
})

describe("browsing the library (p4-F01)", () => {
  it("says a thumbnail is unavailable instead of drawing a broken image", () => {
    loaded(makeMedia({ items: [photo(0)] }))
    const { container } = renderTab()
    const tile = container.querySelector('[data-media-id="m0"]')!
    fireEvent.error(tile.querySelector("img")!)
    expect(tile.querySelector("img")).toBeNull()
    expect(within(tile as HTMLElement).getByText("Photo unavailable"))
    expect(
      screen.getByRole("button", {
        name: "Preview Interior photo, added 1 Jul 2026 (photo unavailable)",
      })
    ).toBeInTheDocument()
  })

  it("says the lightbox photo can’t be shown and points at the original", async () => {
    const user = userEvent.setup()
    loaded(makeMedia({ items: [photo(0)] }))
    renderTab()
    await user.click(
      screen.getByRole("button", { name: /^Preview Interior photo/ })
    )
    const dialog = screen.getByRole("dialog")
    fireEvent.error(within(dialog).getByRole("img"))
    expect(
      within(dialog).getByText(
        "This photo can’t be shown here. Open the original on Google to see it."
      )
    ).toBeInTheDocument()
    expect(
      within(dialog).getByRole("link", { name: "Open original" })
    ).toBeInTheDocument()
  })

  it("marks a grid the new filter has not answered yet as loading and inert", () => {
    searchParams = new URLSearchParams("ownership=customer")
    // Still the unfiltered answer (keepPreviousData).
    loaded(makeMedia({ ownership: null }))
    const { container } = renderTab()
    expect(screen.getByText("Loading matching photos…")).toHaveAttribute(
      "role",
      "status"
    )
    const grid = screen.getByRole("list", { name: "Photos" })
    const wrapper = grid.closest('[aria-busy="true"]')
    expect(wrapper).not.toBeNull()
    expect(wrapper).toHaveClass("pointer-events-none")
    expect(container.querySelector('[aria-busy="true"]')).toBe(wrapper)
  })

  it("is not busy once the server's echo matches the filters", () => {
    searchParams = new URLSearchParams("ownership=customer")
    loaded(makeMedia({ ownership: "customer" }))
    const { container } = renderTab()
    expect(screen.queryByText("Loading matching photos…")).toBeNull()
    expect(container.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it("counts the lightbox position against everything, not just what loaded", async () => {
    const user = userEvent.setup()
    const items = Array.from({ length: 12 }, (_, index) => photo(index))
    loaded(
      makeMedia({ items, total: 15, paging: { ...noMore, hasMore: true } })
    )
    const { container } = renderTab()
    await user.click(
      container.querySelector<HTMLElement>('[data-media-id="m0"] > button')!
    )
    expect(screen.getByText("1 of 12 loaded · 15 in all")).toBeInTheDocument()
  })

  it("names the empty library’s next step only to someone who can add", () => {
    loaded(makeMedia({ items: [], total: 0 }), { canPublish: false })
    renderTab()
    expect(screen.getByText("No photos yet")).toBeInTheDocument()
    expect(
      screen.getByText(
        "Google has no photos for this listing yet. Refresh from Google if someone added them on Google directly."
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/Use Add photos/)).toBeNull()
    expect(screen.queryByText(/above/)).toBeNull()
  })

  it("tells a publisher to use Add photos, and announces a filtered empty result", () => {
    loaded(makeMedia({ items: [], total: 0 }))
    const first = renderTab()
    expect(screen.getByText(/Use Add photos to upload the first ones/))
    first.unmount()

    searchParams = new URLSearchParams("category=INTERIOR")
    loaded(makeMedia({ items: [], total: 0, category: "INTERIOR" }))
    renderTab()
    const status = screen
      .getByText("No matching photos")
      .closest('[role="status"]')
    expect(status).not.toBeNull()
    // Clear filters is outside the announced region.
    expect(
      within(status as HTMLElement).queryByRole("button", {
        name: "Clear filters",
      })
    ).toBeNull()
    expect(
      screen.getByRole("button", { name: "Clear filters" })
    ).toBeInTheDocument()
  })

  it("confirms a manual refresh once Google answers, and only that one", async () => {
    const user = userEvent.setup()
    fetchMediaMock.mockResolvedValue(makeMedia({ total: 3 }))
    updateMediaCategoryMock.mockResolvedValue(sentAnswer)
    loaded(makeMedia())
    renderTab()

    await user.click(
      screen.getByRole("button", { name: /Refresh from Google/ })
    )
    expect(
      await screen.findByText("Refreshed from Google: 3 items")
    ).toBeInTheDocument()
    expect(fetchMediaMock).toHaveBeenCalledWith("loc-1", {
      pageSize: expect.any(Number),
      refresh: true,
      category: undefined,
      ownership: undefined,
    })

    // A write's own re-read is spoken for by the write's toast.
    fetchMediaMock.mockClear()
    await user.click(
      screen.getAllByRole("button", { name: /^Use as logo: Interior photo/ })[0]
    )
    expect(
      await screen.findByText("Logo updated on Google")
    ).toBeInTheDocument()
    await waitFor(() => expect(fetchMediaMock).toHaveBeenCalledTimes(1))
    expect(screen.getAllByText("Refreshed from Google: 3 items")).toHaveLength(
      1
    )
  })
})

describe("adding photos (p4-F02)", () => {
  // jsdom has no object URLs for the thumbnails; lend it a pair.
  const realCreate = URL.createObjectURL
  const realRevoke = URL.revokeObjectURL
  beforeEach(() => {
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:preview"),
      revokeObjectURL: vi.fn(),
    })
  })
  afterEach(() => {
    Object.assign(URL, {
      createObjectURL: realCreate,
      revokeObjectURL: realRevoke,
    })
  })

  it("retries an unconfirmed upload with the same intent and category, and re-reads the library", async () => {
    const user = userEvent.setup()
    fetchMediaMock.mockResolvedValue(makeMedia())
    uploadMediaFileMock
      .mockRejectedValueOnce(
        new ApiClientError(0, "network_error", "The upload could not finish.")
      )
      .mockResolvedValueOnce(sentAnswer)
    loaded(makeMedia())
    renderTab()
    await openAddWith(user, [jpeg("bar.jpg")])
    await user.click(screen.getByRole("button", { name: "Upload 1 photo" }))

    expect(await screen.findByText("Not confirmed")).toBeInTheDocument()
    // It may be on Google: the library is re-read so the page can say so.
    await waitFor(() => expect(fetchMediaMock).toHaveBeenCalled())
    expect(
      await screen.findByText("Google hasn’t confirmed this photo")
    ).toBeInTheDocument()
    expect(screen.queryByText("No photos were uploaded")).toBeNull()
    expect(screen.getByText("1 not confirmed")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Remove bar.jpg from this list" })
    ).toBeInTheDocument()

    const firstIntent = uploadMediaFileMock.mock.calls[0][3].intentId
    const firstForm = uploadMediaFileMock.mock.calls[0][1] as FormData
    await user.click(
      screen.getByRole("button", { name: "Try again to upload bar.jpg" })
    )
    await waitFor(() => expect(uploadMediaFileMock).toHaveBeenCalledTimes(2))
    const [, retryForm, , retryOptions] = uploadMediaFileMock.mock.calls[1]
    expect(retryOptions.intentId).toBe(firstIntent)
    expect((retryForm as FormData).get("category")).toBe(
      firstForm.get("category")
    )
    expect(await screen.findByText("Live on Google")).toBeInTheDocument()
  })

  it("retries a definite failure as a new upload", async () => {
    const user = userEvent.setup()
    uploadMediaFileMock
      .mockRejectedValueOnce(
        new ApiClientError(
          502,
          "media_upload_interrupted",
          "The upload did not finish."
        )
      )
      .mockResolvedValueOnce(sentAnswer)
    loaded(makeMedia())
    renderTab()
    await openAddWith(user, [jpeg("bar.jpg")])
    await user.click(screen.getByRole("button", { name: "Upload 1 photo" }))
    expect(await screen.findByText("Failed")).toBeInTheDocument()
    // Nothing may have landed, so nothing is re-read.
    expect(fetchMediaMock).not.toHaveBeenCalled()

    await user.click(
      screen.getByRole("button", { name: "Try again to upload bar.jpg" })
    )
    await waitFor(() => expect(uploadMediaFileMock).toHaveBeenCalledTimes(2))
    expect(uploadMediaFileMock.mock.calls[1][3].intentId).not.toBe(
      uploadMediaFileMock.mock.calls[0][3].intentId
    )
  })

  it("offers no retry for an upload waiting on a person's verdict", async () => {
    const user = userEvent.setup()
    fetchMediaMock.mockResolvedValue(makeMedia())
    uploadMediaFileMock.mockRejectedValueOnce(
      new ApiClientError(409, "media_needs_resolution", "Not confirmed.")
    )
    loaded(makeMedia())
    renderTab()
    await openAddWith(user, [jpeg("bar.jpg")])
    await user.click(screen.getByRole("button", { name: "Upload 1 photo" }))
    expect(await screen.findByText("Not confirmed")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Try again to upload bar.jpg" })
    ).toBeNull()
    expect(
      screen.getByText(/use “It is on Google” or “It is not on Google”/)
    ).toBeInTheDocument()
  })

  it("stops at a two-step check, asks for the code once and sends nothing else", async () => {
    const user = userEvent.setup()
    const stepUp = vi.fn()
    window.addEventListener(MFA_STEP_UP_EVENT, stepUp)
    uploadMediaFileMock.mockRejectedValue(
      new ApiClientError(403, "mfa_step_up_required", "Step up.")
    )
    loaded(makeMedia())
    renderTab()
    await openAddWith(user, [jpeg("one.jpg"), jpeg("two.jpg")])
    await user.click(screen.getByRole("button", { name: "Upload 2 photos" }))

    expect(
      await screen.findByText(/Confirm it’s you with your two-step code/)
    ).toBeInTheDocument()
    expect(uploadMediaFileMock).toHaveBeenCalledTimes(1)
    expect(stepUp).toHaveBeenCalledTimes(1)
    expect((stepUp.mock.calls[0][0] as CustomEvent).detail).toEqual({
      code: "mfa_step_up_required",
    })
    // Both are still to send, and no card repeats a permission refusal.
    expect(
      screen.getByRole("button", { name: "Upload 2 photos" })
    ).toBeEnabled()
    expect(screen.queryByText(/permission/)).toBeNull()
    expect(screen.queryByText("No photos were uploaded")).toBeNull()
    window.removeEventListener(MFA_STEP_UP_EVENT, stepUp)
  })

  it("ends a finished run on Done, keeping focus, and Done closes", async () => {
    const user = userEvent.setup()
    fetchMediaMock.mockResolvedValue(makeMedia())
    uploadMediaFileMock.mockResolvedValue(sentAnswer)
    loaded(makeMedia())
    renderTab()
    await openAddWith(user, [jpeg("bar.jpg")])
    const primary = screen.getByRole("button", { name: "Upload 1 photo" })
    await user.click(primary)

    const done = await screen.findByRole("button", { name: "Done" })
    expect(done).toBe(primary)
    expect(done).toHaveFocus()
    expect(
      await screen.findByText("1 photo sent to Google")
    ).toBeInTheDocument()
    await user.click(done)
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Add photos" })).toBeNull()
    )
  })

  it("shows a link import’s refusal beside the field", async () => {
    const user = userEvent.setup()
    createMediaFromUrlMock.mockRejectedValue(
      new ApiClientError(
        422,
        "media_source_unreachable",
        "Google could not fetch it."
      )
    )
    loaded(makeMedia())
    renderTab()
    await user.click(screen.getByRole("button", { name: "Add photos" }))
    const field = await screen.findByLabelText("Photo URL")
    await user.type(field, "https://example.com/a.jpg")
    await user.click(screen.getByRole("button", { name: "Add from URL" }))
    await waitFor(() => expect(field).toHaveAttribute("aria-invalid", "true"))
    const describedBy = field.getAttribute("aria-describedby")!
    expect(document.getElementById(describedBy)?.textContent).toBeTruthy()
    await user.type(field, "x")
    expect(field).not.toHaveAttribute("aria-invalid")
  })

  it("puts Saving… on the tapped verdict only", async () => {
    const user = userEvent.setup()
    resolveMediaCreateMock.mockReturnValue(new Promise(() => {}))
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
    await user.click(screen.getByRole("button", { name: "It is on Google" }))
    expect(await screen.findByText("Saving…")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "It is not on Google" })
    ).toBeDisabled()
  })

  it("tells someone who can’t publish who records the verdict", () => {
    loaded(
      makeMedia({
        canPublish: false,
        unresolvedCreates: [
          {
            attemptId: "attempt-1",
            mediaFormat: "PHOTO",
            category: null,
            description: null,
            fileName: null,
            sourceUrl: null,
            startedAt: new Date().toISOString(),
          },
        ],
      })
    )
    renderTab()
    expect(
      screen.getByText(/Someone who can publish to Google needs to check/)
    ).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "It is on Google" })).toBeNull()
  })
})

describe("deleting a photo (p4-F03)", () => {
  async function askToDelete(
    user: ReturnType<typeof userEvent.setup>,
    container: HTMLElement,
    id = "m0"
  ) {
    const bin = container.querySelector<HTMLElement>(
      `[data-media-id="${id}"] button[aria-label^="Delete "]`
    )!
    await user.click(bin)
    return screen.findByRole("alertdialog")
  }

  it("names the photo in the question, and Keep sends nothing", async () => {
    const user = userEvent.setup()
    loaded(makeMedia())
    const { container } = renderTab()
    const dialog = await askToDelete(user, container)
    expect(
      within(dialog).getByRole("heading", {
        name: "Delete this interior photo from Google?",
      })
    ).toBeInTheDocument()
    await user.click(
      within(dialog).getByRole("button", { name: "Keep the photo" })
    )
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(deleteMediaItemMock).not.toHaveBeenCalled()
  })

  it("says what a confirmed delete means and puts focus on the next tile", async () => {
    const user = userEvent.setup()
    fetchMediaMock.mockResolvedValue(makeMedia())
    deleteMediaItemMock.mockResolvedValue(sentAnswer)
    loaded(makeMedia())
    const { container } = renderTab()
    const dialog = await askToDelete(user, container)
    await user.click(
      within(dialog).getByRole("button", { name: "Delete from Google" })
    )
    expect(
      await screen.findByText("Photo deleted from Google")
    ).toBeInTheDocument()
    expect(
      screen.getByText("Customers may still see it on Maps for a few minutes.")
    ).toBeInTheDocument()
    expect(fetchMediaMock).toHaveBeenCalled()
    await waitFor(() =>
      expect(
        container.querySelector('[data-media-id="m1"] > button')
      ).toHaveFocus()
    )
  })

  it("keeps a stale refusal in the dialog, re-reads, and deletes Google’s current version", async () => {
    const user = userEvent.setup()
    fetchMediaMock.mockResolvedValue(makeMedia())
    deleteMediaItemMock
      .mockRejectedValueOnce(
        new ApiClientError(409, "media_stale", "Google changed this.")
      )
      .mockResolvedValueOnce(sentAnswer)
    loaded(makeMedia())
    const { container, rerender } = renderTab()
    const dialog = await askToDelete(user, container)
    await user.click(
      within(dialog).getByRole("button", { name: "Delete from Google" })
    )
    expect(
      await within(dialog).findByText("The photo wasn’t deleted")
    ).toBeInTheDocument()
    // Not a second announcement: the toast already spoke.
    expect(within(dialog).queryByRole("alert")).toBeNull()

    await user.click(
      within(dialog).getByRole("button", { name: /Refresh from Google/ })
    )
    await waitFor(() => expect(fetchMediaMock).toHaveBeenCalled())
    // The re-read lands with Google's current hash.
    loaded(makeMedia({ items: [photo(0, { googleHash: "h0-new" }), photo(1)] }))
    rerender()
    expect(
      await within(dialog).findByText(/This is Google’s latest version/)
    ).toBeInTheDocument()
    await user.click(
      within(dialog).getByRole("button", { name: "Delete from Google" })
    )
    await waitFor(() => expect(deleteMediaItemMock).toHaveBeenCalledTimes(2))
    expect(deleteMediaItemMock.mock.calls[1][2]).toEqual({
      expectedGoogleHash: "h0-new",
    })
  })

  it("says when the re-read no longer holds the photo, and won't resend the stale copy", async () => {
    const user = userEvent.setup()
    fetchMediaMock.mockResolvedValue(makeMedia())
    deleteMediaItemMock.mockRejectedValueOnce(
      new ApiClientError(409, "media_stale", "Google changed this.")
    )
    loaded(makeMedia())
    const { container, rerender } = renderTab()
    const dialog = await askToDelete(user, container, "m2")
    await user.click(
      within(dialog).getByRole("button", { name: "Delete from Google" })
    )
    await within(dialog).findByText("The photo wasn’t deleted")
    await user.click(
      within(dialog).getByRole("button", { name: /Refresh from Google/ })
    )
    // A photo reached through Load more isn't on the re-read first page.
    loaded(makeMedia({ items: [photo(0), photo(1)] }))
    rerender()
    expect(
      await within(dialog).findByText(/doesn’t include this one any more/)
    ).toBeInTheDocument()
    expect(
      within(dialog).getByRole("button", { name: "Delete from Google" })
    ).toBeDisabled()
    expect(deleteMediaItemMock).toHaveBeenCalledTimes(1)
  })

  it("says an unconfirmed delete is safe to try again, and resends its intent", async () => {
    const user = userEvent.setup()
    deleteMediaItemMock.mockRejectedValue(
      new ApiClientError(0, "network_error", "No answer.")
    )
    loaded(makeMedia())
    const { container } = renderTab()
    const dialog = await askToDelete(user, container)
    await user.click(
      within(dialog).getByRole("button", { name: "Delete from Google" })
    )
    expect(
      await within(dialog).findByText("We couldn’t confirm the delete")
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "Try again" }))
    await waitFor(() => expect(deleteMediaItemMock).toHaveBeenCalledTimes(2))
    expect(deleteMediaItemMock.mock.calls[1][3].intentId).toBe(
      deleteMediaItemMock.mock.calls[0][3].intentId
    )
  })

  it("disables Keep while the delete is on its way", async () => {
    const user = userEvent.setup()
    deleteMediaItemMock.mockReturnValue(new Promise(() => {}))
    loaded(makeMedia())
    const { container } = renderTab()
    const dialog = await askToDelete(user, container)
    await user.click(
      within(dialog).getByRole("button", { name: "Delete from Google" })
    )
    expect(
      await within(dialog).findByText("Deleting from Google…")
    ).toBeInTheDocument()
    expect(
      within(dialog).getByRole("button", { name: "Keep the photo" })
    ).toBeDisabled()
  })

  it("goes back to the lightbox when the delete asked from it is kept", async () => {
    const user = userEvent.setup()
    loaded(makeMedia())
    const { container } = renderTab()
    await user.click(
      container.querySelector<HTMLElement>('[data-media-id="m1"] > button')!
    )
    await user.click(screen.getByRole("button", { name: "Delete from Google" }))
    const dialog = await screen.findByRole("alertdialog")
    await user.click(
      within(dialog).getByRole("button", { name: "Keep the photo" })
    )
    expect(
      await screen.findByRole("heading", { name: "Interior" })
    ).toBeInTheDocument()
    expect(screen.getByText("2 of 3")).toBeInTheDocument()
  })
})
