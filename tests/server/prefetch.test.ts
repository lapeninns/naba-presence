import { describe, expect, it, vi } from "vitest"

import { settingsCapabilitiesSchema } from "@/lib/contracts/location-capabilities"
import {
  reviewCountsSchema,
  reviewsPageSchema,
  type ReviewCapabilities,
} from "@/lib/contracts/reviews"
import { queryKeys } from "@/lib/queries/keys"
import { makeQueryClient } from "@/lib/queries/query-client"
import {
  homePrefetch,
  locationTabPrefetch,
  prefetch,
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
      {
        queryKey: queryKeys.reviewCounts("organisation"),
        load: async () =>
          throughWire(reviewCountsSchema, {
            total: 0,
            byStatus: {},
            byQueue: {
              needs_reply: 0,
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
  it("homePrefetch targets the counts and analytics keys OverviewView reads", () => {
    expect(homePrefetch()(session).map((entry) => entry.queryKey)).toEqual([
      queryKeys.reviewCounts("organisation"),
      queryKeys.analytics("overview", { window: "last-30-days" }),
    ])
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
