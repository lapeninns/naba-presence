import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PostsTab } from "@/components/locations/posts-tab"
import type { Post } from "@/lib/api/location-posts"
import type { PublicationSchedule } from "@/lib/contracts/publication-schedules"
import {
  matchesPostFilter,
  type PostFilter,
} from "@/lib/locations/post-display"
import type { ListPaging } from "@/lib/queries/paged-list"
import type { PostsView } from "@/lib/queries/use-location-posts"
import { renderWithProviders } from "../helpers/render"

// p4-F04: browsing the posts list. The schedule line in words, the view
// names, the history's truth for posts made on Google, and the waits.

const usePostsMock = vi.fn()
const useCapsMock = vi.fn()
const refreshPosts = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
  isError: false,
}))
vi.mock("@/lib/queries/use-location-posts", () => ({
  useRefreshPosts: () => refreshPosts,
  usePosts: (...args: unknown[]) => usePostsMock(...args),
}))
vi.mock("@/lib/queries/use-location-capabilities", () => ({
  useLocationCapabilities: () => useCapsMock(),
}))
const api = vi.hoisted(() => ({ deletePost: vi.fn() }))
vi.mock("@/lib/api/location-posts", async (original) => ({
  ...(await original<typeof import("@/lib/api/location-posts")>()),
  deletePost: api.deletePost,
}))

const LOCATION = "00000000-0000-4000-8000-0000000000aa"
const DRAFT = "00000000-0000-4000-8000-0000000000b1"

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: DRAFT,
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
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  }
}

function schedule(
  overrides: Partial<PublicationSchedule> = {}
): PublicationSchedule {
  return {
    id: "00000000-0000-4000-8000-00000000c001",
    locationId: LOCATION,
    locationName: "Old Crown",
    status: "active",
    statusReason: null,
    revision: 1,
    payloadHash: "a".repeat(64),
    rule: { frequency: "once", startDate: "2026-10-20", localTime: "09:00" },
    timezone: "Europe/London",
    offsetMinutes: 60,
    eventOffsets: null,
    template: { topicType: "STANDARD", summary: "Open late tonight" },
    sourcePostId: DRAFT,
    sourceContentRevision: 1,
    requestedBy: "00000000-0000-4000-8000-0000000000d1",
    approvedBy: "00000000-0000-4000-8000-0000000000d1",
    approvedAt: "2026-10-12T10:00:00.000Z",
    requiresSecondApprover: false,
    canApprove: false,
    preview: {
      total: 1,
      first: [],
      skippedDates: [],
      adjusted: 0,
      problem: null,
    },
    counts: {},
    ...overrides,
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

let schedules: PublicationSchedule[] = []
beforeEach(() => {
  schedules = []
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes("/legacy-post-schedules"))
        return json({ legacySchedules: [] })
      if (url.includes("/post-schedules")) return json({ schedules })
      return json({}, 404)
    })
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const noMore: ListPaging = {
  hasMore: false,
  loadingMore: false,
  loadMoreFailed: false,
  loadMore: () => {},
}

function view(posts: Post[], loaded: PostFilter = "all") {
  const count = (filter: PostFilter) =>
    posts.filter((row) => matchesPostFilter(row, filter)).length
  return {
    data: {
      posts,
      counts: {
        all: posts.length,
        draft: count("draft"),
        awaiting: count("awaiting"),
        published: count("published"),
        attention: count("attention"),
        live: posts.filter(
          (row) => row.status === "published" && row.googleState === "LIVE"
        ).length,
      },
      filter: loaded,
      paging: noMore,
      writesEnabled: true,
      reconciliationError: null,
      timezone: undefined,
    } satisfies PostsView & { paging: ListPaging },
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }
}

function renderTab(posts: Post[], caps: Record<string, unknown> = {}) {
  usePostsMock.mockReturnValue(view(posts))
  useCapsMock.mockReturnValue({
    data: { canEditCanonical: true, canPublish: true, ...caps },
  })
  return renderWithProviders(<PostsTab locationId={LOCATION} />)
}

describe("Posts list: what a row says", () => {
  it("says a post's schedule in words, the same as the schedules list", async () => {
    schedules = [schedule()]
    renderTab([post()], { postScheduling: true })
    const card = screen.getByRole("article", { name: "Open late tonight" })
    // 2026-10-20 is a Tuesday, and London is on summer time then.
    expect(
      await within(card).findByText("Scheduled for Tue 20 Oct, 09:00 BST")
    ).toBeInTheDocument()
    expect(card).not.toHaveTextContent("Europe/London")
    expect(card).not.toHaveTextContent("2026-10-20")

    // Publishing by hand names the same moment.
    await userEvent.click(
      within(card).getByRole("button", { name: "Publish now" })
    )
    expect(
      await screen.findByText(
        /This post is also scheduled for Tue 20 Oct, 09:00 BST\./
      )
    ).toBeInTheDocument()
  })

  it("adds the schedule's state when it is not simply on its way", async () => {
    schedules = [schedule({ status: "awaiting_approval" })]
    renderTab([post()], { postScheduling: true })
    expect(
      await screen.findByText(
        "Scheduled for Tue 20 Oct, 09:00 BST · Awaiting approval"
      )
    ).toBeInTheDocument()
  })

  it("names the sent view for what it holds, not as all on Google", async () => {
    renderTab([post({ id: "a", summary: "A draft" })])
    const chips = screen.getByRole("group", { name: "Filter posts by status" })
    expect(
      within(chips).getByRole("button", { name: /^Sent to Google/ })
    ).toBeInTheDocument()
    expect(within(chips).queryByText("On Google")).toBeNull()
  })

  it("keeps today's track when the server sends no localEditedAt", () => {
    renderTab([
      post({
        status: "published",
        googlePostName: "locations/1/localPosts/9",
        googleState: "LIVE",
      }),
    ])
    expect(
      screen.getByRole("list", { name: "Post history", hidden: true })
    ).toHaveTextContent("Drafted, done")
  })

  it("names each History disclosure by its post", () => {
    renderTab([
      post({ id: "a", summary: "Quiz night" }),
      post({ id: "b", summary: "Closed Monday" }),
    ])
    const summaries = screen
      .getAllByText("History")
      .map((node) => node.closest("summary")?.textContent)
    expect(summaries).toEqual(
      expect.arrayContaining([
        "History of Quiz night",
        "History of Closed Monday",
      ])
    )
  })

  it("draws a not-confirmed note in the warning tone and a failure in danger", () => {
    renderTab([
      post({ id: "a", summary: "Unclear post", status: "ambiguous" }),
      post({ id: "b", summary: "Failed post", status: "failed" }),
    ])
    const unclear = within(
      screen.getByRole("article", { name: "Unclear post" })
    ).getByRole("note")
    expect(unclear).toHaveClass("bg-warning-tint")
    expect(unclear).not.toHaveClass("bg-danger-tint")
    const failed = within(
      screen.getByRole("article", { name: "Failed post" })
    ).getByRole("note")
    expect(failed).toHaveClass("bg-danger-tint")
  })
})

describe("Posts list: switching views", () => {
  it("says the view is loading while it is on its way", async () => {
    const user = userEvent.setup()
    // The loaded view stays "all" with a live post: under Drafts nothing
    // matches yet, so the list would be an empty box.
    usePostsMock.mockReturnValue(
      view([
        post({
          status: "published",
          googlePostName: "locations/1/localPosts/9",
          googleState: "LIVE",
        }),
      ])
    )
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderWithProviders(<PostsTab locationId={LOCATION} />)
    await user.click(screen.getByRole("button", { name: /^Drafts/ }))
    expect(screen.getByText("Loading drafts…")).toHaveAttribute(
      "role",
      "status"
    )
    expect(screen.queryByText("No posts in this view")).toBeNull()
    expect(screen.queryByText(/^Showing/)).toBeNull()
  })
})

describe("Posts list: focus after a delete", () => {
  it("moves focus to the next post's heading once a post is deleted", async () => {
    const user = userEvent.setup()
    api.deletePost.mockResolvedValue({ status: "deleted" })
    renderTab([
      post({
        id: "a",
        summary: "First post",
        updatedAt: "2026-10-03T00:00:00.000Z",
      }),
      post({
        id: "b",
        summary: "Second post",
        updatedAt: "2026-10-02T00:00:00.000Z",
      }),
    ])
    await user.click(
      screen.getByRole("button", { name: "More actions for First post" })
    )
    await user.click(await screen.findByRole("menuitem", { name: /^Delete/ }))
    const dialog = await screen.findByRole("alertdialog")
    await user.click(within(dialog).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "Second post" })
      )
    )
  })

  it("moves focus to the chosen view's chip when the view's only post goes", async () => {
    const user = userEvent.setup()
    api.deletePost.mockResolvedValue({ status: "deleted" })
    renderTab([post({ id: "a", summary: "Only post" })])
    await user.click(
      screen.getByRole("button", { name: "More actions for Only post" })
    )
    await user.click(await screen.findByRole("menuitem", { name: /^Delete/ }))
    const dialog = await screen.findByRole("alertdialog")
    await user.click(within(dialog).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: /^All/, pressed: true })
      )
    )
  })
})
