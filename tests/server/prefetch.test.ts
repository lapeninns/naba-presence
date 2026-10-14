import { describe, expect, it, vi } from "vitest"

import { settingsCapabilitiesSchema } from "@/lib/contracts/location-capabilities"
import { hoursStateSchema } from "@/lib/contracts/location-hours"
import { mediaStateSchema } from "@/lib/contracts/location-media"
import { postsListResponseSchema } from "@/lib/contracts/location-posts"
import {
  reviewCountsSchema,
  reviewsPageSchema,
  type ReviewCapabilities,
} from "@/lib/contracts/reviews"
import { parseInboxState, toReviewsFilters } from "@/lib/inbox/url-state"
import { queryKeys } from "@/lib/queries/keys"
import { makeQueryClient } from "@/lib/queries/query-client"
import {
  hoursTabPrefetch,
  inboxPrefetch,
  locationTabPrefetch,
  photosTabPrefetch,
  postsTabPrefetch,
  PREFETCH_SKIP,
  prefetch,
  readHours,
  readMediaFirstPage,
  readPostsFirstPage,
  readReviewsFirstPage,
  readSettingsCapabilities,
  throughWire,
} from "@/lib/server/prefetch"
import type { InboxQueryRow } from "@/lib/server/reviews-query"
import type { Session } from "@/lib/server/session"

// The readers that hit Postgres/Google are not exercised here (they are the
// same functions the routes call, covered by tests/integration). What this
// file pins is the contract between the prefetch and the client cache: the
// hydrated value must parse with the lib/contracts schema `apiFetch` uses,
// land under the key the hook reads, and never throw.
vi.mock("@/lib/server/db", () => ({ withTenant: vi.fn() }))
vi.mock("@/lib/server/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/server/review-reads", () => ({
  readReviewsPage: vi.fn(),
  readReviewDetail: vi.fn(),
}))
vi.mock("@/lib/server/listing-reads", () => ({
  readHoursResponse: vi.fn(),
  readMediaListResponse: vi.fn(),
  readPostsListResponse: vi.fn(),
}))
vi.mock("@/lib/server/location-summary", () => ({
  readListingSummaries: vi.fn(async () => []),
}))

const UUID = "00000000-0000-4000-8000-000000000001"
const LOCATION = "00000000-0000-4000-8000-000000000010"

const session: Session = {
  sessionId: "00000000-0000-4000-8000-000000000020",
  userId: "00000000-0000-4000-8000-000000000002",
  organisationId: UUID,
  organisationName: "Org",
  workspaceMode: "business",
  displayName: "Test",
  email: "test@example.test",
  role: "owner",
  canPublish: true,
}

const CAPS: ReviewCapabilities = {
  canPublish: true,
  canEdit: true,
  canRequestApproval: false,
}

function row(
  id: string,
  updateTime: Date,
  rating: number | null = 5
): InboxQueryRow & { capabilities: ReviewCapabilities } {
  return {
    id,
    location: {
      id: LOCATION,
      name: "Riverside",
      clientId: null,
      clientName: null,
    },
    reviewer: { displayName: "A", isAnonymous: false, profilePhotoUrl: null },
    rating,
    text: "Lovely",
    detectedLanguageCode: "en",
    languageConfidence: 0.9,
    createTime: updateTime,
    updateTime,
    hasMedia: false,
    workflowStatus: "new",
    draftId: null,
    draftBody: null,
    verificationStatus: null,
    replyStatus: null,
    googleReplyState: null,
    googlePolicyViolation: null,
    replyBody: null,
    syncStatus: null,
    capabilities: CAPS,
  }
}

describe("throughWire", () => {
  it("serialises Dates to ISO strings and drops undefined, like NextResponse.json", () => {
    const at = new Date("2026-09-01T10:00:00.000Z")
    const out = throughWire(reviewsPageSchema, {
      items: [{ ...row("r1", at), extra: undefined }],
      nextCursor: null,
    })
    expect(out.items[0].updateTime).toBe("2026-09-01T10:00:00.000Z")
    expect(out.items[0].createTime).toBe("2026-09-01T10:00:00.000Z")
    expect("extra" in out.items[0]).toBe(false)
  })

  it("rejects a payload the client parser would reject", () => {
    expect(() =>
      throughWire(reviewCountsSchema, { total: "3", byStatus: {} })
    ).toThrow()
  })
})

// The count aggregation moved to lib/server/review-counts.ts so the route and
// the prefetch share one implementation; it needs a transaction now, so it is
// covered by tests/integration/routes/review-counts rather than here. What
// stays pinned here is that a hydrated counts payload parses with the schema
// the hook reads.
describe("review counts hydration", () => {
  it("parses a counts payload with reviewCountsSchema", () => {
    const counts = throughWire(reviewCountsSchema, {
      total: 5,
      byStatus: { new: 3, published: 2 },
      byQueue: {
        needs_reply: 3,
        approval: 0,
        awaiting_my_approval: 0,
        awaiting_others: 0,
        publishing: 0,
        failed: 0,
        done: 2,
        all: 5,
      },
    })
    expect(counts.total).toBe(5)
    expect(counts.byQueue.needs_reply).toBe(3)
  })
})

describe("readSettingsCapabilities", () => {
  async function withFeature(enabled: boolean) {
    const { withTenant } = await import("@/lib/server/db")
    vi.mocked(withTenant).mockImplementationOnce(async (_org, fn) =>
      fn((async () => (enabled ? [{ enabled: true }] : [])) as never)
    )
  }

  it("parses with settingsCapabilitiesSchema", async () => {
    await withFeature(false)
    const caps = await readSettingsCapabilities(session)
    expect(settingsCapabilitiesSchema.safeParse(caps).success).toBe(true)
    expect(caps.canEditSettings).toBe(true)
    expect(caps.privacy).toBe("none")
  })

  it("never reads the features for a member, whose answer is fixed", async () => {
    const { withTenant } = await import("@/lib/server/db")
    vi.mocked(withTenant).mockClear()
    const caps = await readSettingsCapabilities({ ...session, role: "member" })
    expect(withTenant).not.toHaveBeenCalled()
    expect(caps.privacy).toBe("none")
    expect(caps.canEditSettings).toBe(false)
  })

  it("opens the Data and privacy area to an owner once the feature is on", async () => {
    await withFeature(true)
    const caps = await readSettingsCapabilities(session)
    expect(caps.privacy).toBe("manage")
  })
})

describe("prefetch", () => {
  it("returns an empty state without a session and never runs a loader", async () => {
    const load = vi.fn()
    const state = await prefetch(null, [{ queryKey: ["x"], load }])
    expect(load).not.toHaveBeenCalled()
    expect(state.queries).toEqual([])
  })

  it("stores fulfilled loads under their keys and swallows rejected ones", async () => {
    const client = makeQueryClient()
    const state = await prefetch(
      session,
      [
        { queryKey: ["ok"], load: async () => ({ value: 1 }) },
        {
          queryKey: ["boom"],
          load: async () => {
            throw new Error("google down")
          },
        },
      ],
      client
    )
    expect(client.getQueryData(["ok"])).toEqual({ value: 1 })
    expect(client.getQueryData(["boom"])).toBeUndefined()
    expect(state.queries.map((query) => query.queryKey)).toEqual([["ok"]])
  })

  it("hydrates into a client under the exact key the hook reads", async () => {
    // The dehydrated state is what a page's <HydrationBoundary> receives; a
    // client-side QueryClient must find the data by the hook's key.
    const { hydrate } = await import("@tanstack/react-query")
    const state = await prefetch(session, [
      {
        queryKey: queryKeys.reviewCounts("organisation"),
        load: async () =>
          throughWire(reviewCountsSchema, {
            total: 0,
            byStatus: {},
            byQueue: {
              needs_reply: 0,
              approval: 0,
              awaiting_my_approval: 0,
              awaiting_others: 0,
              publishing: 0,
              failed: 0,
              done: 0,
              all: 0,
            },
          }),
      },
    ])
    const client = makeQueryClient()
    hydrate(client, state)
    expect(
      client.getQueryData(queryKeys.reviewCounts("organisation"))
    ).toMatchObject({
      total: 0,
      byQueue: expect.objectContaining({ needs_reply: 0 }),
    })
  })
})

describe("page composers", () => {
  // The keys must be the ones InboxView's hooks build from the same URL:
  // useReviews(toReviewsFilters(state)), useReviewCounts({ clientId }) and
  // useReviewDetail(selected). The unscoped counts are the layout's.
  const inboxKeys = (search: string, who: Session = session) =>
    inboxPrefetch(new URLSearchParams(search))(who).map(
      (entry) => entry.queryKey
    )
  const listKey = (search: string, business = false) => {
    const state = parseInboxState(new URLSearchParams(search))
    return queryKeys.reviews(
      "organisation",
      toReviewsFilters(business ? { ...state, clientId: undefined } : state)
    )
  }
  const CLIENT = "00000000-0000-4000-8000-000000000030"
  const REVIEW = "00000000-0000-4000-8000-000000000040"
  const agency: Session = { ...session, workspaceMode: "agency" }

  it("inboxPrefetch hydrates the default queue's first page and nothing else", () => {
    expect(inboxKeys("", agency)).toEqual([listKey("")])
    expect(listKey("")[2]).toMatchObject({ queue: "needs_reply" })
  })

  it("inboxPrefetch follows the URL's queue and filters", () => {
    const search = "queue=done&rating=1,2&search=cold&sort=rating_asc"
    expect(inboxKeys(search, agency)).toEqual([listKey(search)])
    expect(listKey(search)[2]).toMatchObject({
      queue: "done",
      ratings: [1, 2],
      search: "cold",
    })
  })

  it("inboxPrefetch scopes the list and counts to the URL's client", () => {
    const search = `clientId=${CLIENT}`
    expect(inboxKeys(search, agency)).toEqual([
      listKey(search),
      queryKeys.reviewCounts(`organisation:${CLIENT}`),
    ])
  })

  it("inboxPrefetch ignores a client scope in a business, as the view does", () => {
    const search = `clientId=${CLIENT}`
    expect(inboxKeys(search, session)).toEqual([listKey(search, true)])
    expect(listKey(search, true)[2]).not.toHaveProperty("clientId", CLIENT)
  })

  it("inboxPrefetch hydrates an open review, and only a well-formed one", () => {
    expect(inboxKeys(`selected=${REVIEW}`, agency)).toEqual([
      listKey(`selected=${REVIEW}`),
      queryKeys.reviewDetail(REVIEW),
    ])
    expect(inboxKeys("selected=not-a-uuid", agency)).toEqual([
      listKey("selected=not-a-uuid"),
    ])
  })

  it("inboxPrefetch leaves a relative age window to the browser", () => {
    // Its range moves with the hour, so the server's key could miss the
    // browser's and draw rows the hydrating render does not have.
    expect(inboxKeys("age=7d", agency)).toEqual([])
    const explicit = "age=7d&dateFrom=2026-09-01T00:00:00.000Z"
    expect(inboxKeys(explicit, agency)).toEqual([listKey(explicit)])
  })

  it("locationTabPrefetch hydrates capabilities only", () => {
    // Tab state is never prefetched: every tab's reader reaches Google (posts
    // reconciles against it on list), which would gate first paint and every
    // <Link prefetch> on Google for seconds.
    const keys = locationTabPrefetch(LOCATION)(session).map(
      (entry) => entry.queryKey
    )
    expect(keys).toEqual([queryKeys.locationCapabilities(LOCATION)])
  })

  it("locationTabPrefetch is empty without a location", () => {
    expect(locationTabPrefetch(null)(session)).toEqual([])
  })
})

describe("readReviewsFirstPage", () => {
  it("decodes the filters as the route would and stores the infinite-query shape", async () => {
    const { withTenant } = await import("@/lib/server/db")
    const { readReviewsPage } = await import("@/lib/server/review-reads")
    vi.mocked(withTenant).mockImplementationOnce(async (_org, fn) =>
      fn({} as never)
    )
    const at = new Date("2026-09-01T10:00:00.000Z")
    vi.mocked(readReviewsPage).mockResolvedValueOnce({
      items: [row("r1", at)],
      nextCursor: "cursor-1",
    })
    const data = await readReviewsFirstPage(session, {
      queue: "needs_reply",
      ratings: [1],
    })
    expect(data.pageParams).toEqual([null])
    expect(data.pages).toHaveLength(1)
    expect(data.pages[0].items[0].updateTime).toBe("2026-09-01T10:00:00.000Z")
    expect(data.pages[0].nextCursor).toBe("cursor-1")
    expect(reviewsPageSchema.safeParse(data.pages[0]).success).toBe(true)
    const query = vi.mocked(readReviewsPage).mock.calls[0][2]
    expect(query).toMatchObject({ queue: "needs_reply", ratings: [1] })
    expect(query.pageSize).toBeGreaterThan(0)
    expect(query.sort).toBeDefined()
  })
})

// The hours, photos and posts pages stream their editor's first read
// (components/listings/streamed-tab.tsx). The readers are the routes' own
// (lib/server/listing-reads.ts, mocked here); what is pinned is the request
// they are given (the one the browser's fetch would send), the key the
// value lands under (the one the editor's hook reads on its first render)
// and the value's shape after the wire.
describe("streamed listing editors", () => {
  const WEEK = { regular: [], special: [], moreHours: [] }
  const hoursBody = {
    hours: {
      location: {
        id: LOCATION,
        name: "Riverside",
        googleLocationName: "locations/1",
        timezone: "Europe/London",
      },
      canonicalResource: {
        revision: "3",
        updatedAt: new Date("2026-09-01T10:00:00.000Z"),
      },
      status: "in_sync",
      canonical: WEEK,
      google: WEEK,
      canonicalHash: "a",
      googleHash: "a",
      updateMask: [],
      warnings: [],
      canPublish: true,
      writesEnabled: true,
      lastReconciledAt: null,
      latestAttempt: null,
      partStatus: undefined,
    },
  }
  const mediaBody = {
    media: {
      canPublish: true,
      writesEnabled: true,
      categories: [],
      items: [],
      total: 0,
      pageSize: 12,
      nextCursor: "next",
      category: null,
      ownership: null,
      // unresolvedCreates omitted: the client schema defaults it to [].
    },
  }
  const postsBody = {
    posts: [],
    counts: {
      all: 0,
      draft: 0,
      awaiting: 0,
      published: 0,
      attention: 0,
      live: 0,
    },
    filter: "all",
    nextCursor: null,
    timezone: "Europe/London",
    writesEnabled: true,
    reconciliationError: null,
  }

  it("hoursTabPrefetch hydrates useHours' key, then the summary the read refreshes", () => {
    const keys = hoursTabPrefetch(LOCATION)(session).map(
      (entry) => entry.queryKey
    )
    expect(keys).toEqual([
      queryKeys.locationHours(LOCATION),
      queryKeys.listingSummary(LOCATION),
    ])
  })

  it("hoursTabPrefetch re-reads the summary only after the hours read settles, even a failed one", async () => {
    const { readHoursResponse } = await import("@/lib/server/listing-reads")
    const { readListingSummaries } = await import(
      "@/lib/server/location-summary"
    )
    const { withTenant } = await import("@/lib/server/db")
    vi.mocked(withTenant).mockImplementation(async (_org, fn) =>
      fn({} as never)
    )
    vi.mocked(readListingSummaries).mockClear()
    let fail!: (error: Error) => void
    vi.mocked(readHoursResponse).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject
      })
    )
    const [hours, summary] = hoursTabPrefetch(LOCATION)(session)
    const hoursLoad = hours.load()
    const summaryLoad = summary.load()
    await Promise.resolve()
    expect(readListingSummaries).not.toHaveBeenCalled()
    fail(new Error("google down"))
    await expect(hoursLoad).rejects.toThrow("google down")
    await expect(summaryLoad).resolves.toBeNull()
    expect(readListingSummaries).toHaveBeenCalledOnce()
    expect(readHoursResponse).toHaveBeenCalledOnce()
    vi.mocked(withTenant).mockReset()
  })

  it("hoursTabPrefetch does not re-read the summary after an hours read served from storage", async () => {
    const { readHoursResponse } = await import("@/lib/server/listing-reads")
    const { readListingSummaries } = await import(
      "@/lib/server/location-summary"
    )
    vi.mocked(readListingSummaries).mockClear()
    vi.mocked(readHoursResponse).mockResolvedValueOnce({
      hours: { ...hoursBody.hours, source: "stored" },
    } as never)
    const [, summary] = hoursTabPrefetch(LOCATION)(session)
    await expect(summary.load()).resolves.toBe(PREFETCH_SKIP)
    expect(readListingSummaries).not.toHaveBeenCalled()
    const client = makeQueryClient()
    await prefetch(session, [summary], client)
    expect(client.getQueryData(summary.queryKey)).toBeUndefined()
  })

  it("readHours returns the route's hours through the wire", async () => {
    const { readHoursResponse } = await import("@/lib/server/listing-reads")
    vi.mocked(readHoursResponse).mockResolvedValueOnce(hoursBody as never)
    const hours = await readHours(session, LOCATION)
    expect(readHoursResponse).toHaveBeenLastCalledWith(session, LOCATION)
    expect(hours.canonicalResource.updatedAt).toBe("2026-09-01T10:00:00.000Z")
    expect("partStatus" in hours).toBe(false)
    expect(hoursStateSchema.safeParse(hours).success).toBe(true)
  })

  it("photosTabPrefetch keys the first page by the URL's filters, as the tab does", () => {
    const keys = (search: string) =>
      photosTabPrefetch(LOCATION, new URLSearchParams(search))(session).map(
        (entry) => entry.queryKey
      )
    expect(keys("")).toEqual([queryKeys.locationMedia(LOCATION)])
    expect(keys("ownership=customer&category=INTERIOR")).toEqual([
      queryKeys.locationMedia(LOCATION, {
        ownership: "customer",
        category: "INTERIOR",
      }),
    ])
    // Unknown values fall back to the default view, as parsePhotosState does.
    expect(keys("ownership=nobody")).toEqual([
      queryKeys.locationMedia(LOCATION),
    ])
  })

  it("readMediaFirstPage sends fetchMedia's query and stores the infinite-query shape", async () => {
    const { readMediaListResponse } = await import("@/lib/server/listing-reads")
    vi.mocked(readMediaListResponse).mockResolvedValueOnce(mediaBody as never)
    const data = await readMediaFirstPage(session, LOCATION, {
      category: "INTERIOR",
      ownership: null,
    })
    expect(vi.mocked(readMediaListResponse).mock.lastCall).toEqual([
      session,
      LOCATION,
      { pageSize: 12, category: "INTERIOR" },
    ])
    expect(data.pageParams).toEqual([null])
    expect(data.pages).toHaveLength(1)
    expect(data.pages[0].nextCursor).toBe("next")
    expect(data.pages[0].unresolvedCreates).toEqual([])
    expect(mediaStateSchema.safeParse(data.pages[0]).success).toBe(true)
  })

  it("postsTabPrefetch hydrates the 'all' view usePosts opens on", () => {
    const keys = postsTabPrefetch(LOCATION)(session).map(
      (entry) => entry.queryKey
    )
    expect(keys).toEqual([queryKeys.locationPostsView(LOCATION, "all")])
  })

  it("readPostsFirstPage sends no query, as fetchPosts does for 'all'", async () => {
    const { readPostsListResponse } = await import("@/lib/server/listing-reads")
    vi.mocked(readPostsListResponse).mockResolvedValueOnce(postsBody as never)
    const data = await readPostsFirstPage(session, LOCATION)
    expect(vi.mocked(readPostsListResponse).mock.lastCall).toEqual([
      session,
      LOCATION,
      {},
    ])
    expect(data.pageParams).toEqual([null])
    expect(data.pages).toEqual([postsBody])
    expect(postsListResponseSchema.safeParse(data.pages[0]).success).toBe(true)
  })

  it("skips every streamed read for an id the routes would never be sent", () => {
    for (const composer of [
      hoursTabPrefetch("not-a-uuid"),
      photosTabPrefetch("not-a-uuid", new URLSearchParams()),
      postsTabPrefetch("not-a-uuid"),
    ]) {
      expect(composer(session)).toEqual([])
    }
  })

  it("a failed Google read leaves the key empty for the browser to fetch", async () => {
    const { readPostsListResponse } = await import("@/lib/server/listing-reads")
    vi.mocked(readPostsListResponse).mockRejectedValueOnce(
      Object.assign(new Error("google down"), { code: "google_unavailable" })
    )
    const client = makeQueryClient()
    const state = await prefetch(session, postsTabPrefetch(LOCATION), client)
    expect(state.queries).toEqual([])
    const { log } = await import("@/lib/server/logger")
    expect(log.warn).toHaveBeenLastCalledWith(
      "prefetch_failed",
      expect.objectContaining({ code: "google_unavailable" })
    )
  })
})
