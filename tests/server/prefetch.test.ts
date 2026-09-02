import { describe, expect, it, vi } from "vitest"

import { settingsCapabilitiesSchema } from "@/lib/contracts/location-capabilities"
import {
  decodeReviewsCursor,
  reviewCountsSchema,
  reviewsPageSchema,
  type ReviewCapabilities,
} from "@/lib/contracts/reviews"
import { queryKeys } from "@/lib/queries/keys"
import { makeQueryClient } from "@/lib/queries/query-client"
import {
  firstPage,
  homePrefetch,
  inboxPrefetch,
  locationTabPrefetch,
  prefetch,
  readSettingsCapabilities,
  reviewCountsFromRows,
  reviewsPageFromRows,
  throughWire,
  toSearchParams,
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

const UUID = "00000000-0000-4000-8000-000000000001"
const LOCATION = "00000000-0000-4000-8000-000000000010"

const session: Session = {
  sessionId: "00000000-0000-4000-8000-000000000020",
  userId: "00000000-0000-4000-8000-000000000002",
  organisationId: UUID,
  organisationName: "Org",
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
    location: { id: LOCATION, name: "Riverside" },
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

describe("reviewsPageFromRows", () => {
  it("parses with reviewsPageSchema and slices pageSize+1 rows into a page + cursor", () => {
    const t1 = new Date("2026-09-01T10:00:00.000Z")
    const t2 = new Date("2026-09-01T09:00:00.000Z")
    const t3 = new Date("2026-09-01T08:00:00.000Z")
    const page = reviewsPageFromRows(
      [row(UUID, t1), row(LOCATION, t2, 4), row("extra", t3)],
      2
    )
    expect(reviewsPageSchema.safeParse(page).success).toBe(true)
    expect(page.items.map((item) => item.id)).toEqual([UUID, LOCATION])
    expect(decodeReviewsCursor(page.nextCursor)).toEqual({
      updateTime: "2026-09-01T09:00:00.000Z",
      id: LOCATION,
      rating: 4,
    })
  })

  it("returns a null cursor when the page is not full", () => {
    const page = reviewsPageFromRows([row(UUID, new Date())], 50)
    expect(page.nextCursor).toBeNull()
    expect(page.items).toHaveLength(1)
  })
})

describe("reviewCountsFromRows", () => {
  it("zero-fills every workflow state and parses with reviewCountsSchema", () => {
    const counts = reviewCountsFromRows([
      { workflowStatus: "new", count: 3 },
      { workflowStatus: "published", count: 2 },
    ])
    expect(reviewCountsSchema.safeParse(counts).success).toBe(true)
    expect(counts.total).toBe(5)
    expect(counts.byStatus.new).toBe(3)
    expect(counts.byStatus.escalated).toBe(0)
  })
})

describe("readSettingsCapabilities", () => {
  it("parses with settingsCapabilitiesSchema", () => {
    const caps = readSettingsCapabilities(session)
    expect(settingsCapabilitiesSchema.safeParse(caps).success).toBe(true)
    expect(caps.canManageCompliance).toBe(true)
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
      { queryKey: queryKeys.reviewCounts("organisation"), load: async () => reviewCountsFromRows([]) },
    ])
    const client = makeQueryClient()
    hydrate(client, state)
    expect(client.getQueryData(queryKeys.reviewCounts("organisation"))).toEqual({
      total: 0,
      byStatus: expect.objectContaining({ new: 0 }),
    })
  })
})

describe("page composers", () => {
  it("inboxPrefetch keys the first page by the URL's filters and counts by its location", () => {
    const entries = inboxPrefetch(
      toSearchParams({ queue: "published", locationId: LOCATION, rating: "5,4" })
    )(session)
    expect(entries.map((entry) => entry.queryKey)).toEqual([
      queryKeys.reviews("organisation", {
        locationId: LOCATION,
        ratings: [5, 4],
        statuses: ["published"],
        replyState: undefined,
        verification: undefined,
        publishStatus: undefined,
        syncStatus: undefined,
        dateFrom: undefined,
        dateTo: undefined,
        search: undefined,
        sort: "updated_desc",
      }),
      queryKeys.reviewCounts(LOCATION),
    ])
  })

  it("inboxPrefetch defaults an empty URL to the needs_reply queue, organisation-wide", () => {
    const entries = inboxPrefetch(toSearchParams({}))(session)
    const [reviews, counts] = entries.map((entry) => entry.queryKey)
    expect(reviews[2]).toMatchObject({
      statuses: ["new", "drafted", "verified", "failed", "rejected"],
    })
    expect(counts).toEqual(queryKeys.reviewCounts("organisation"))
  })

  it("firstPage is the InfiniteData shape useInfiniteQuery hydrates from", () => {
    expect(firstPage({ items: [], nextCursor: null })).toEqual({
      pages: [{ items: [], nextCursor: null }],
      pageParams: [null],
    })
  })

  it("homePrefetch targets the counts and analytics keys OverviewView reads", () => {
    expect(homePrefetch()(session).map((entry) => entry.queryKey)).toEqual([
      queryKeys.reviewCounts("organisation"),
      queryKeys.analytics("overview", { window: "last-30-days" }),
    ])
  })

  it("locationTabPrefetch pairs capabilities with the tab resource", () => {
    const keys = locationTabPrefetch(LOCATION, "photos")(session).map(
      (entry) => entry.queryKey
    )
    expect(keys).toEqual([
      queryKeys.locationCapabilities(LOCATION),
      queryKeys.locationMedia(LOCATION, {
        page: 1,
        category: null,
        ownership: null,
      }),
    ])
  })

  it("locationTabPrefetch keys photos by the URL's page and filters, as PhotosTab does", () => {
    const keys = locationTabPrefetch(
      LOCATION,
      "photos",
      toSearchParams({ page: "2", ownership: "customer", category: "INTERIOR" })
    )(session).map((entry) => entry.queryKey)
    expect(keys[1]).toEqual(
      queryKeys.locationMedia(LOCATION, {
        page: 2,
        category: "INTERIOR",
        ownership: "customer",
      })
    )
  })

  it("locationTabPrefetch skips owner/admin-only resources for a member", () => {
    const member: Session = { ...session, role: "member" }
    const keys = locationTabPrefetch(LOCATION, "administration")(member).map(
      (entry) => entry.queryKey
    )
    expect(keys).toEqual([queryKeys.locationCapabilities(LOCATION)])
    expect(
      locationTabPrefetch(LOCATION, "administration")(session)
    ).toHaveLength(2)
  })

  it("locationTabPrefetch is empty without a location", () => {
    expect(locationTabPrefetch(null, "hours")(session)).toEqual([])
  })

  it("toSearchParams keeps the first value of a repeated key, as URLSearchParams.get does", () => {
    const params = toSearchParams({ queue: ["all", "published"], x: undefined })
    expect(params.get("queue")).toBe("all")
    expect(params.has("x")).toBe(false)
  })
})
