import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PostsTab } from "@/components/locations/posts-tab"
import { Toaster } from "@/components/ui/toast"
import type { Post, PostsState } from "@/lib/api/location-posts"

const usePostsMock = vi.fn()
const useCapsMock = vi.fn()
vi.mock("@/lib/queries/use-location-posts", () => ({ usePosts: () => usePostsMock() }))
vi.mock("@/lib/queries/use-location-capabilities", () => ({ useLocationCapabilities: () => useCapsMock() }))

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: "p1", topicType: "STANDARD", languageCode: "en-GB", summary: "Open late tonight", callToAction: null, event: null, offer: null, media: [],
    status: "draft", googlePostName: null, googleState: null, googleSearchUrl: null, lastErrorCode: null,
    createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", ...overrides,
  }
}
function makeState(overrides: Partial<PostsState> = {}): PostsState {
  return { posts: [post()], writesEnabled: true, reconciliationError: null, ...overrides }
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <PostsTab locationId="loc-1" />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("PostsTab", () => {
  it("opens on the posts, not on an empty form, and previews what is typed", async () => {
    const user = userEvent.setup()
    usePostsMock.mockReturnValue({ data: makeState(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(screen.getByText("Open late tonight")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled()
    // The composer used to sit permanently above the list, so the page opened
    // on a blank form rather than on the posts.
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull()

    await user.click(screen.getByRole("button", { name: "New post" }))
    const sheet = await screen.findByRole("dialog")
    expect(within(sheet).getByRole("button", { name: "Save draft" })).toBeDisabled()
    await user.type(
      within(sheet).getByRole("textbox", { name: "Post summary" }),
      "Late opening on Friday"
    )
    expect(within(sheet).getAllByText("Late opening on Friday").length).toBe(2)
    expect(within(sheet).getByRole("button", { name: "Save draft" })).toBeEnabled()
  })

  it("shows a paused notice and blocks composing when posts are paused", async () => {
    const user = userEvent.setup()
    usePostsMock.mockReturnValue({ data: makeState({ writesEnabled: false }), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    const trigger = screen.getByRole("button", { name: "New post" })
    expect(trigger).toBeDisabled()
    await user.click(trigger)
    expect(screen.queryByRole("dialog")).toBeNull()
    // A disabled control with no reason beside it is the thing this rebuild
    // exists to remove.
    expect(
      screen.getByText(
        "Publishing to Google is currently unavailable, so new posts cannot be composed."
      )
    ).toBeInTheDocument()
  })

  it("shows the second-approver copy path via an awaiting-approval post for a publisher", () => {
    usePostsMock.mockReturnValue({ data: makeState({ posts: [post({ status: "awaiting_approval" })] }), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument()
    expect(screen.getByText("Awaiting approval")).toBeInTheDocument()
  })
})
