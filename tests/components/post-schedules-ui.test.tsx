import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PostsTab } from "@/components/locations/posts-tab"
import type { Post } from "@/lib/api/location-posts"
import { localWallTime } from "@/lib/domain/publication-schedule"
import type {
  LegacySchedule,
  PublicationSchedule,
} from "@/lib/contracts/publication-schedules"
import { matchesPostFilter } from "@/lib/locations/post-display"
import type { ListPaging } from "@/lib/queries/paged-list"
import type { PostsView } from "@/lib/queries/use-location-posts"
import { renderWithProviders } from "../helpers/render"

const usePostsMock = vi.fn()
const useCapsMock = vi.fn()
vi.mock("@/lib/queries/use-location-posts", () => ({
  usePosts: () => usePostsMock(),
}))
vi.mock("@/lib/queries/use-location-capabilities", () => ({
  useLocationCapabilities: () => useCapsMock(),
}))

const LOCATION = "00000000-0000-4000-8000-0000000000aa"
const DRAFT = "00000000-0000-4000-8000-0000000000b1"
const OTHER = "00000000-0000-4000-8000-0000000000b2"
const LEGACY_POST = "00000000-0000-4000-8000-0000000000b3"

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: DRAFT,
    topicType: "STANDARD",
    languageCode: "en-GB",
    summary: "Sunday roast is back",
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

let n = 0
function schedule(
  overrides: Partial<PublicationSchedule> = {}
): PublicationSchedule {
  n += 1
  return {
    id: `00000000-0000-4000-8000-00000000c${String(n).padStart(3, "0")}`,
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
    template: { topicType: "STANDARD", summary: "Sunday roast is back" },
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
let legacy: LegacySchedule[] = []
let role = "owner"
const calls: Array<{ method: string; url: string; body: unknown }> = []

beforeEach(() => {
  schedules = []
  legacy = []
  role = "owner"
  calls.length = 0
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      const method = init?.method ?? "GET"
      calls.push({
        method,
        url,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      })
      if (url.includes("/api/session"))
        return json({
          session: {
            userId: "00000000-0000-4000-8000-0000000000d1",
            organisationId: "org",
            organisationName: "Old Crown",
            displayName: "Owner",
            email: "owner@example.test",
            role,
            canPublish: true,
            workspaceMode: "business",
          },
        })
      if (url.includes("/legacy-post-schedules/") && method === "PATCH") {
        legacy = []
        return json({ dismissed: true })
      }
      if (url.includes("/legacy-post-schedules"))
        return json({ legacySchedules: legacy })
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

function renderTab(posts: Post[], caps: Record<string, unknown>) {
  const count = (filter: Parameters<typeof matchesPostFilter>[1]) =>
    posts.filter((row) => matchesPostFilter(row, filter)).length
  usePostsMock.mockReturnValue({
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
      filter: "all",
      paging: noMore,
      writesEnabled: true,
      reconciliationError: null,
      timezone: undefined,
    } satisfies PostsView & { paging: ListPaging },
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  })
  useCapsMock.mockReturnValue({
    data: { canEditCanonical: true, canPublish: true, ...caps },
  })
  return renderWithProviders(<PostsTab locationId={LOCATION} />)
}

describe("Posts tab scheduling (P08-R5)", () => {
  it("offers Publish now and Schedule for a draft, and neither schedule for a post already scheduled", async () => {
    schedules = [schedule({ sourcePostId: OTHER, status: "active" })]
    renderTab(
      [
        post(),
        post({ id: OTHER, summary: "Quiz night" }),
        post({
          id: "00000000-0000-4000-8000-0000000000b9",
          summary: "Already live",
          status: "published",
          googlePostName: "accounts/1/locations/2/localPosts/3",
          googleState: "LIVE",
        }),
      ],
      { postScheduling: true }
    )
    expect(screen.getAllByRole("button", { name: "Publish now" })).toHaveLength(
      2
    )
    // Scheduling is in each post's "More actions" menu.
    const user = userEvent.setup()
    const scheduleOffered = async (name: string) => {
      await user.click(
        screen.getByRole("button", { name: `More actions for ${name}` })
      )
      const menu = await screen.findByRole("menu")
      const offered =
        within(menu).queryByRole("menuitem", {
          name: "Schedule publication",
        }) !== null
      await user.keyboard("{Escape}")
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull())
      return offered
    }
    expect(await scheduleOffered("Sunday roast is back")).toBe(true)
    // A published post cannot be scheduled.
    expect(await scheduleOffered("Already live")).toBe(false)
    // The scheduled post says so and is changed from its schedule instead.
    expect(
      await screen.findByText(
        /Scheduled publication active: 2026-10-20 at 09:00 \(Europe\/London, UTC\+01:00\)/
      )
    ).toBeInTheDocument()
    expect(await scheduleOffered("Quiz night")).toBe(false)

    // Publishing it by hand says the scheduled publication will not run.
    const card = screen.getByText("Quiz night").closest("li") as HTMLElement
    await user.click(within(card).getByRole("button", { name: "Publish now" }))
    expect(
      await screen.findByText(/This post is also scheduled/)
    ).toBeInTheDocument()
  })

  it("shows a missed slot as missed, with a new time instead of resume or retry", async () => {
    schedules = [
      schedule({ status: "needs_review", statusReason: "paused_when_due" }),
      schedule({
        status: "blocked",
        statusReason: "connection_changed",
        sourcePostId: OTHER,
        template: { topicType: "STANDARD", summary: "Quiz night" },
      }),
    ]
    renderTab([post()], { postScheduling: true })
    const list = await screen.findByRole("region", {
      name: "Publication schedules",
    })
    const missed = (await within(list).findByText("Missed")).closest(
      "li"
    ) as HTMLElement
    expect(
      within(missed).getByText(/paused when its time came/)
    ).toBeInTheDocument()
    expect(
      within(missed).getByRole("button", { name: "Choose a new time" })
    ).toBeInTheDocument()
    expect(
      within(missed).queryByRole("button", { name: /Resume|Retry/ })
    ).toBeNull()
    const blocked = within(list)
      .getByText("Blocked")
      .closest("li") as HTMLElement
    expect(
      within(blocked).getByText(/listing or connection changed/)
    ).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(
      within(missed).getByRole("button", { name: "Choose a new time" })
    )
    expect(
      await screen.findByRole("dialog", {
        name: "Choose a new publication time",
      })
    ).toBeInTheDocument()
  })

  it("lets an owner dismiss an old per-post time, or schedule the post from it", async () => {
    // Still ahead and inside the 90-day limit, so the sheet offers it.
    const oldTime = new Date(
      Math.ceil((Date.now() + 10 * 86_400_000) / 3_600_000) * 3_600_000
    ).toISOString()
    const wall = localWallTime(oldTime, "Europe/London")
    legacy = [
      {
        id: "00000000-0000-4000-8000-0000000000e1",
        postId: LEGACY_POST,
        summary: "Bonfire night",
        topicType: "STANDARD",
        scheduledPublishTime: oldTime,
        repeats: true,
        schedulable: true,
        alreadyScheduled: false,
        createdAt: "2026-10-10T00:00:00.000Z",
      },
    ]
    renderTab([post()], { postScheduling: true })
    const section = await screen.findByRole("region", {
      name: "Old post times to review",
    })
    expect(
      within(section).getByText(
        `Was set for ${wall.date} ${wall.time} (Europe/London), with a repeat that is no longer used.`
      )
    ).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(
      within(section).getByRole("button", {
        name: "Schedule post: Bonfire night",
      })
    )
    const sheet = await screen.findByRole("dialog", {
      name: "Schedule publication",
    })
    // The old time is offered as the starting point, not silently used.
    expect(within(sheet).getByLabelText("Date")).toHaveValue(wall.date)
    expect(within(sheet).getByLabelText("Local time")).toHaveValue(wall.time)
    await user.click(within(sheet).getByRole("button", { name: "Cancel" }))

    await user.click(
      within(section).getByRole("button", {
        name: "Dismiss old time: Bonfire night",
      })
    )
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Old post times to review" })
      ).toBeNull()
    )
    expect(calls.find((call) => call.method === "PATCH")).toMatchObject({
      url: `/api/locations/${LOCATION}/legacy-post-schedules/00000000-0000-4000-8000-0000000000e1`,
      body: { action: "dismiss" },
    })
  })

  it("offers only Dismiss for an old time whose post is already scheduled, and drops a suggestion that has passed", async () => {
    legacy = [
      {
        id: "00000000-0000-4000-8000-0000000000e1",
        postId: LEGACY_POST,
        summary: "Bonfire night",
        topicType: "STANDARD",
        scheduledPublishTime: "2099-11-05T18:00:00.000Z",
        repeats: false,
        schedulable: false,
        alreadyScheduled: true,
        createdAt: "2026-10-10T00:00:00.000Z",
      },
      {
        id: "00000000-0000-4000-8000-0000000000e2",
        postId: LEGACY_POST,
        summary: "Quiz night",
        topicType: "STANDARD",
        scheduledPublishTime: "2020-01-01T18:00:00.000Z",
        repeats: false,
        schedulable: true,
        alreadyScheduled: false,
        createdAt: "2026-10-10T00:00:00.000Z",
      },
    ]
    renderTab([post()], { postScheduling: true })
    const section = await screen.findByRole("region", {
      name: "Old post times to review",
    })
    expect(
      within(section).getByText(
        "This post already has a publication scheduled. Dismiss the old time."
      )
    ).toBeInTheDocument()
    expect(
      within(section).queryByRole("button", {
        name: "Schedule post: Bonfire night",
      })
    ).toBeNull()
    expect(
      within(section).getByRole("button", {
        name: "Dismiss old time: Bonfire night",
      })
    ).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(
      within(section).getByRole("button", { name: "Schedule post: Quiz night" })
    )
    const sheet = await screen.findByRole("dialog", {
      name: "Schedule publication",
    })
    // A time already passed is not offered: the default (tomorrow, 09:00).
    expect(within(sheet).getByLabelText("Date")).not.toHaveValue("2020-01-01")
    expect(within(sheet).getByLabelText("Local time")).toHaveValue("09:00")
  })

  it("shows no old post times to a member", async () => {
    role = "member"
    legacy = [
      {
        id: "00000000-0000-4000-8000-0000000000e1",
        postId: LEGACY_POST,
        summary: "Bonfire night",
        topicType: "STANDARD",
        scheduledPublishTime: null,
        repeats: false,
        schedulable: false,
        alreadyScheduled: false,
        createdAt: "2026-10-10T00:00:00.000Z",
      },
    ]
    renderTab([post()], { postScheduling: true })
    await screen.findByRole("region", { name: "Publication schedules" })
    expect(
      screen.queryByRole("region", { name: "Old post times to review" })
    ).toBeNull()
    expect(
      calls.some((call) => call.url.includes("legacy-post-schedules"))
    ).toBe(false)
  })

  it("hides every scheduling control with the feature off", async () => {
    legacy = [
      {
        id: "00000000-0000-4000-8000-0000000000e1",
        postId: LEGACY_POST,
        summary: "Bonfire night",
        topicType: "STANDARD",
        scheduledPublishTime: null,
        repeats: true,
        schedulable: true,
        alreadyScheduled: false,
        createdAt: "2026-10-10T00:00:00.000Z",
      },
    ]
    renderTab([post()], { postScheduling: false })
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Publish now" })).toBeNull()
    expect(
      screen.queryByRole("button", { name: /^Schedule publication/ })
    ).toBeNull()
    await waitFor(() =>
      expect(calls.some((call) => call.url.includes("/post-schedules"))).toBe(
        true
      )
    )
    expect(
      screen.queryByRole("region", { name: "Old post times to review" })
    ).toBeNull()
    expect(
      calls.some((call) => call.url.includes("legacy-post-schedules"))
    ).toBe(false)
  })
})
