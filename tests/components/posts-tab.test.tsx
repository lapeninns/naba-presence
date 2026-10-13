import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PostsTab } from "@/components/locations/posts-tab"
import { Toaster } from "@/components/ui/toast"
import type { Post } from "@/lib/api/location-posts"
import type { ListPaging } from "@/lib/queries/paged-list"
import type { PostsView } from "@/lib/queries/use-location-posts"
import { matchesPostFilter } from "@/lib/locations/post-display"

const usePostsMock = vi.fn()
const useCapsMock = vi.fn()
vi.mock("@/lib/queries/use-location-posts", () => ({ usePosts: (...args: unknown[]) => usePostsMock(...args) }))
vi.mock("@/lib/queries/use-location-capabilities", () => ({ useLocationCapabilities: () => useCapsMock() }))

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: "p1",
    topicType: "STANDARD",
    languageCode: "en-GB",
    summary: "Open late tonight",
    callToAction: null,
    event: null,
    offer: null,
    media: [],
    status: "draft",
    googlePostName: null,
    googleState: null,
    googleSearchUrl: null,
    lastErrorCode: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  }
}
const noMore: ListPaging = { hasMore: false, loadingMore: false, loadMoreFailed: false, loadMore: () => {} }
type View = PostsView & { paging: ListPaging }
function countsOf(posts: Post[]): View["counts"] {
  const count = (filter: Parameters<typeof matchesPostFilter>[1]) => posts.filter((row) => matchesPostFilter(row, filter)).length
  return {
    all: posts.length, draft: count("draft"), awaiting: count("awaiting"), published: count("published"), attention: count("attention"),
    live: posts.filter((row) => row.status === "published" && row.googleState === "LIVE").length,
  }
}
function makeState(overrides: Partial<View> = {}): View {
  const posts = overrides.posts ?? [post()]
  return { posts, counts: countsOf(posts), filter: "all", paging: noMore, writesEnabled: true, reconciliationError: null, timezone: undefined, ...overrides }
}

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
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
    usePostsMock.mockReturnValue({
      data: makeState(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    expect(screen.getByText("Open late tonight")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled()
    // The composer used to sit permanently above the list, so the page opened
    // on a blank form rather than on the posts.
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull()

    await user.click(screen.getByRole("button", { name: "New post" }))
    const sheet = await screen.findByRole("dialog")
    expect(
      within(sheet).getByRole("button", { name: "Save draft" })
    ).toBeDisabled()
    await user.type(
      within(sheet).getByRole("textbox", { name: "Post summary" }),
      "Late opening on Friday"
    )
    expect(within(sheet).getAllByText("Late opening on Friday").length).toBe(2)
    expect(
      within(sheet).getByRole("button", { name: "Save draft" })
    ).toBeEnabled()
  })

  it("sets a post to repeat weekly and shows the repeat on the list", async () => {
    const user = userEvent.setup()
    usePostsMock.mockReturnValue({
      data: makeState({
        posts: [
          post({
            topicType: "EVENT",
            event: {
              title: "Quiz night",
              schedule: {
                startDate: { year: 2026, month: 10, day: 2 },
                endDate: { year: 2026, month: 10, day: 2 },
              },
              recurrenceInfo: { weeklyPattern: { daysOfWeek: ["FRIDAY"] } },
            },
          }),
        ],
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
    expect(screen.getByText(/Repeats weekly on Fri/)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "More actions for Quiz night" }))
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }))
    const sheet = await screen.findByRole("dialog")
    const group = within(sheet).getByRole("group", { name: "On" })
    expect(within(group).getByRole("button", { name: "Fri" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    await user.click(within(group).getByRole("button", { name: "Sat" }))
    expect(
      within(sheet).getAllByText("Repeats weekly on Fri, Sat").length
    ).toBeGreaterThan(0)
    expect(
      within(sheet).getByRole("button", { name: "Save changes" })
    ).toBeEnabled()
  })

  it("asks before closing a composer with unsaved text, and keeps it when the operator stays", async () => {
    const user = userEvent.setup()
    usePostsMock.mockReturnValue({ data: makeState(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    await user.click(screen.getByRole("button", { name: "New post" }))
    const sheet = await screen.findByRole("dialog")
    await user.type(within(sheet).getByRole("textbox", { name: "Post summary" }), "Late opening")

    await user.click(within(sheet).getByRole("button", { name: "Cancel" }))
    const prompt = await screen.findByRole("alertdialog", { name: "Close without saving?" })
    await user.click(within(prompt).getByRole("button", { name: "Keep editing" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(within(screen.getByRole("dialog")).getByRole("textbox", { name: "Post summary" })).toHaveValue("Late opening")

    await user.keyboard("{Escape}")
    const again = await screen.findByRole("alertdialog", { name: "Close without saving?" })
    await user.click(within(again).getByRole("button", { name: "Close and discard" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

    // Reopening starts from an empty post: the discarded text is gone.
    await user.click(screen.getByRole("button", { name: "New post" }))
    expect(within(await screen.findByRole("dialog")).getByRole("textbox", { name: "Post summary" })).toHaveValue("")
  })

  it("closes a clean edit at once, and keeps edits to a saved post across a close that was declined", async () => {
    const user = userEvent.setup()
    usePostsMock.mockReturnValue({ data: makeState(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    const edit = async () => {
      await user.click(screen.getByRole("button", { name: "More actions for Open late tonight" }))
      await user.click(await screen.findByRole("menuitem", { name: "Edit" }))
    }
    await edit()
    let sheet = await screen.findByRole("dialog")
    await user.click(within(sheet).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(screen.queryByRole("alertdialog")).toBeNull()

    await edit()
    sheet = await screen.findByRole("dialog")
    const summary = within(sheet).getByRole("textbox", { name: "Post summary" })
    await user.clear(summary)
    await user.type(summary, "Closed for refit")
    await user.click(within(sheet).getByRole("button", { name: "Cancel" }))
    const prompt = await screen.findByRole("alertdialog", { name: "Close without saving?" })
    expect(prompt).toHaveTextContent("keeps the saved draft")
    await user.click(within(prompt).getByRole("button", { name: "Keep editing" }))
    expect(within(screen.getByRole("dialog")).getByRole("textbox", { name: "Post summary" })).toHaveValue("Closed for refit")
  })

  it("shows a paused notice and blocks composing when posts are paused", async () => {
    const user = userEvent.setup()
    usePostsMock.mockReturnValue({
      data: makeState({ writesEnabled: false }),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    const trigger = screen.getByRole("button", { name: "New post" })
    expect(trigger).toBeDisabled()
    await user.click(trigger)
    expect(screen.queryByRole("dialog")).toBeNull()
    // A disabled control with no reason beside it is the thing this rebuild
    // exists to remove.
    expect(
      screen.getByText(
        "Publishing to Google is currently unavailable, so new posts cannot be composed. Publishing and deleting posts also wait until it’s back."
      )
    ).toBeInTheDocument()
  })

  it("shows the second-approver copy path via an awaiting-approval post for a publisher", async () => {
    usePostsMock.mockReturnValue({
      data: makeState({ posts: [post({ status: "awaiting_approval" })] }),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument()
    // The status filter chip carries the same words, so read the post's own pill.
    expect(
      within(screen.getByRole("article")).getByText("Awaiting approval")
    ).toBeInTheDocument()
    // Reject is a second choice, so it is in the post's menu.
    await userEvent.click(screen.getByRole("button", { name: "More actions for Open late tonight" }))
    expect(await screen.findByRole("menuitem", { name: "Reject" })).toBeInTheDocument()
  })

  // P08-R1: scheduling is an organisation feature, off by default.
  it("offers no scheduling while the organisation's post_scheduling feature is off", () => {
    usePostsMock.mockReturnValue({
      data: makeState(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true, postScheduling: false },
    })
    renderTab()
    expect(screen.getByText("Open late tonight")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /^Schedule publication/ })
    ).toBeNull()
    expect(
      screen.queryByRole("heading", { name: "Publication schedules" })
    ).toBeNull()
  })

  it("schedules one-time publications only unless repeating schedules are on", async () => {
    const user = userEvent.setup()
    usePostsMock.mockReturnValue({
      data: makeState(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true, postScheduling: true },
    })
    const view = renderTab()
    await user.click(
      screen.getByRole("button", { name: "More actions for Open late tonight" })
    )
    await user.click(
      await screen.findByRole("menuitem", { name: "Schedule publication" })
    )
    const sheet = await screen.findByRole("dialog", {
      name: "Schedule publication",
    })
    expect(
      within(sheet).queryByRole("radiogroup", { name: "How often" })
    ).toBeNull()
    // A new one-time schedule opens on preset rows; the full form (Date,
    // Local time) is the "Pick a date and time" row.
    await user.click(
      within(sheet).getByRole("radio", { name: "Pick a date and time" })
    )
    expect(within(sheet).getByLabelText("Date")).toBeInTheDocument()
    view.unmount()

    useCapsMock.mockReturnValue({
      data: {
        canEditCanonical: true,
        canPublish: true,
        postScheduling: true,
        postSchedulingRecurring: true,
      },
    })
    renderTab()
    await user.click(
      screen.getByRole("button", { name: "More actions for Open late tonight" })
    )
    await user.click(
      await screen.findByRole("menuitem", { name: "Schedule publication" })
    )
    const repeating = await screen.findByRole("dialog", {
      name: "Schedule publication",
    })
    expect(
      within(repeating).getByRole("radiogroup", { name: "How often" })
    ).toBeInTheDocument()
  })
})

it("shows unavailable dates for legacy published posts and orders by content time", () => {
  usePostsMock.mockReturnValue({
    data: makeState({
      posts: [
        post({
          id: "old",
          summary: "Older content recently reconciled",
          status: "published",
          googleState: "LIVE",
          providerUpdatedAt: "2026-08-01T00:00:00Z",
          updatedAt: "2026-09-27T00:00:00Z",
        }),
        post({
          id: "new",
          summary: "Newer content",
          status: "published",
          googleState: "LIVE",
          providerUpdatedAt: "2026-09-01T00:00:00Z",
          updatedAt: "2026-09-02T00:00:00Z",
        }),
        post({
          id: "missing",
          summary: "Provider date missing",
          status: "published",
          providerCreatedAt: null,
          providerUpdatedAt: "bad",
        }),
      ],
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
  expect(screen.getByText("Date unavailable")).toBeInTheDocument()
  const summaries = screen.getAllByText(
    /^(Newer content|Older content recently reconciled|Provider date missing)$/
  )
  expect(summaries.map((element) => element.textContent)).toEqual([
    "Newer content",
    "Older content recently reconciled",
    "Provider date missing",
  ])
})

describe("PostsTab paging and views", () => {
  it("counts every view from the server, not the loaded page, and loads more with an announced count", async () => {
    const user = userEvent.setup()
    const loadMore = vi.fn()
    usePostsMock.mockReturnValue({
      data: makeState({
        posts: [post({ id: "a", summary: "First draft" })],
        counts: { all: 41, draft: 25, awaiting: 3, published: 10, attention: 3, live: 9 },
        paging: { ...noMore, hasMore: true, loadMore },
      }),
      isPending: false, isError: false, error: null, refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(screen.getByRole("button", { name: /Drafts/ })).toHaveTextContent("25")
    // The counts are on the filter chips; the area header above owns the
    // status, so the list repeats no summary pill.
    expect(screen.getByRole("button", { name: /Needs attention/ })).toHaveTextContent("3")
    expect(screen.getByText("Showing 1 of 41 posts")).toHaveAttribute("role", "status")
    await user.click(screen.getByRole("button", { name: "Load more posts" }))
    expect(loadMore).toHaveBeenCalledTimes(1)
  })

  it("asks the server for the chosen view and keeps the list while it loads", async () => {
    const user = userEvent.setup()
    usePostsMock.mockReturnValue({ data: makeState(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(usePostsMock).toHaveBeenLastCalledWith("loc-1", "all")
    await user.click(screen.getByRole("button", { name: /Drafts/ }))
    expect(usePostsMock).toHaveBeenLastCalledWith("loc-1", "draft")
    // The placeholder is still the "all" view: no count claims to describe it.
    expect(screen.queryByText(/^Showing/)).toBeNull()
  })
})
