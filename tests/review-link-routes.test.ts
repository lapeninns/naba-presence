import { beforeEach, describe, expect, it, vi } from "vitest"

import { GET, PATCH, POST } from "@/app/api/locations/[id]/review-link/route"
import { GET as GET_STATS } from "@/app/api/locations/[id]/review-link/stats/route"
import type {
  ReviewLinkState,
  ReviewLinkStats,
} from "@/lib/domain/review-link-contract"
import { ApiError } from "@/lib/server/http"
import {
  requireLocationAccess,
  requireLocationAction,
} from "@/lib/server/permissions"
import {
  createReviewLink,
  readReviewLinkState,
  readReviewLinkStats,
  REVIEW_LINK_LOCATION_NOT_FOUND,
  updateReviewLink,
} from "@/lib/server/review-links"
import { requireSession } from "@/lib/server/session"

// Route-level tests for /api/locations/[id]/review-link and .../stats: the
// location gate (read access for GET, the "edit" action for writes), the
// 201/200 split on create, each PATCH action passed through, the stats
// period, and ApiErrors mapped to their status and code. Permissions and the
// review-link service are mocked; the DB-backed flows are tested elsewhere.

const APP = "http://localhost"
const ORG = "00000000-0000-4000-8000-000000000001"
const USER = "00000000-0000-4000-8000-000000000002"
const LOCATION = "11111111-1111-4111-8111-111111111111"
const LINK = "22222222-2222-4222-8222-222222222222"
const TARGET = "https://search.google.com/local/writereview?placeid=ChIJvenue"
const BASE_URL = "https://app.example.test"

vi.mock("@/lib/server/env", () => ({
  getServerEnv: () => ({ NEXTAUTH_URL: BASE_URL }),
}))
vi.mock("@/lib/server/session", () => ({
  requireSession: vi.fn(),
  requireRole: vi.fn((session: unknown) => session),
}))
vi.mock("@/lib/server/db", () => ({
  withTenant: vi.fn(
    async (_organisationId: string, fn: (sql: unknown) => Promise<unknown>) =>
      fn(dummySql)
  ),
}))
vi.mock("@/lib/server/permissions", () => ({
  requireLocationAccess: vi.fn(),
  requireLocationAction: vi.fn(),
}))
vi.mock("@/lib/server/review-links", () => ({
  readReviewLinkState: vi.fn(),
  createReviewLink: vi.fn(),
  updateReviewLink: vi.fn(),
  readReviewLinkStats: vi.fn(),
  reviewLinkBaseUrl: vi.fn(() => "https://app.example.test"),
  REVIEW_LINK_LOCATION_NOT_FOUND: {
    code: "location_not_found",
    message: "The requested location was not found.",
  },
}))

const dummySql = { dummy: "sql" }

const state: ReviewLinkState = {
  link: {
    id: LINK,
    code: "abcdefghjk",
    url: `${BASE_URL}/r/abcdefghjk`,
    qrUrl: `${BASE_URL}/r/abcdefghjk?s=qr`,
    caption: null,
    targetUri: TARGET,
    status: "live",
    createdAt: "2026-10-01T09:00:00.000Z",
    rotatedAt: null,
    disabledAt: null,
  },
  googleTarget: TARGET,
  targetChanged: false,
  canManage: true,
}

const stats = (days: 30 | 90): ReviewLinkStats => ({
  days,
  timeZone: "Europe/London",
  startDate: "2026-10-01",
  endDate: "2026-10-30",
  series: [{ date: "2026-10-30", clicks: 3, qrClicks: 2, newReviews: 1 }],
  totals: { clicks: 3, qrClicks: 2, newReviews: 1 },
})

function asRole(role: "owner" | "admin" | "member" | "viewer") {
  vi.mocked(requireSession).mockResolvedValue({
    sessionId: "s",
    userId: USER,
    organisationId: ORG,
    organisationName: "Harbour Agency",
    workspaceMode: "business",
    displayName: "Priya Owner",
    email: "priya@example.test",
    role,
    canPublish: true,
  } as never)
}

const context = (id = LOCATION) => ({ params: Promise.resolve({ id }) })
const url = (id = LOCATION, suffix = "") =>
  `${APP}/api/locations/${id}/review-link${suffix}`

const get = (id = LOCATION) => GET(new Request(url(id)), context(id))
const getStats = (query = "", id = LOCATION) =>
  GET_STATS(new Request(url(id, `/stats${query}`)), context(id))

function mutation(method: "POST" | "PATCH", body: unknown, id = LOCATION) {
  return new Request(url(id), {
    method,
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin: APP,
      "sec-fetch-site": "same-origin",
    },
  })
}
const post = (body: unknown = {}, id = LOCATION) =>
  POST(mutation("POST", body, id), context(id))
const patch = (body: unknown, id = LOCATION) =>
  PATCH(mutation("PATCH", body, id), context(id))

const denied = () =>
  new ApiError(403, "permission_denied", "You can't change this listing.")
const hidden = () =>
  new ApiError(
    404,
    "location_not_found",
    "The requested location was not found."
  )

beforeEach(() => {
  vi.clearAllMocks()
  asRole("owner")
  vi.mocked(requireLocationAccess).mockResolvedValue(undefined as never)
  vi.mocked(requireLocationAction).mockResolvedValue(undefined as never)
  vi.mocked(readReviewLinkState).mockResolvedValue(state)
  vi.mocked(createReviewLink).mockResolvedValue({
    link: state.link!,
    created: true,
  })
  vi.mocked(updateReviewLink).mockResolvedValue(state.link!)
  vi.mocked(readReviewLinkStats).mockImplementation(async (_sql, _id, days) =>
    stats(days)
  )
})

describe("GET /api/locations/[id]/review-link", () => {
  it("answers 200 with the state, uncached", async () => {
    const response = await get()
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    await expect(response.json()).resolves.toEqual({ reviewLink: state })
    expect(requireLocationAccess).toHaveBeenCalledWith(
      dummySql,
      expect.objectContaining({ organisationId: ORG, userId: USER }),
      LOCATION,
      REVIEW_LINK_LOCATION_NOT_FOUND
    )
    expect(readReviewLinkState).toHaveBeenCalledWith(
      dummySql,
      expect.objectContaining({ organisationId: ORG }),
      LOCATION,
      BASE_URL
    )
  })

  it("refuses an id that is not a uuid with 400", async () => {
    const response = await get("not-a-uuid")
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_request",
    })
    expect(requireLocationAccess).not.toHaveBeenCalled()
    expect(readReviewLinkState).not.toHaveBeenCalled()
  })

  it("is a 404 for a location the caller cannot see", async () => {
    vi.mocked(requireLocationAccess).mockRejectedValue(hidden())
    const response = await get()
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: "location_not_found",
    })
    expect(readReviewLinkState).not.toHaveBeenCalled()
  })
})

describe("POST /api/locations/[id]/review-link", () => {
  it("checks the edit action and answers 201 with the state when it creates one", async () => {
    const response = await post({ caption: "Thanks for visiting" })
    expect(response.status).toBe(201)
    expect(response.headers.get("cache-control")).toBe("no-store")
    await expect(response.json()).resolves.toEqual({ reviewLink: state })
    expect(requireLocationAction).toHaveBeenCalledWith(
      dummySql,
      expect.objectContaining({ organisationId: ORG }),
      LOCATION,
      "edit",
      REVIEW_LINK_LOCATION_NOT_FOUND
    )
    expect(createReviewLink).toHaveBeenCalledTimes(1)
    expect(createReviewLink).toHaveBeenCalledWith(
      dummySql,
      expect.objectContaining({
        locationId: LOCATION,
        baseUrl: BASE_URL,
        caption: "Thanks for visiting",
        requestId: expect.any(String),
        session: expect.objectContaining({ organisationId: ORG }),
      })
    )
    expect(readReviewLinkState).toHaveBeenCalledWith(
      dummySql,
      expect.anything(),
      LOCATION,
      BASE_URL
    )
  })

  it("answers 200 when the link already existed", async () => {
    vi.mocked(createReviewLink).mockResolvedValue({
      link: state.link!,
      created: false,
    })
    const response = await post()
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ reviewLink: state })
  })

  it("is a 404 for a location the caller cannot see", async () => {
    vi.mocked(requireLocationAction).mockRejectedValue(hidden())
    const response = await post()
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: "location_not_found",
    })
    expect(createReviewLink).not.toHaveBeenCalled()
  })

  it("returns the service's 409 when Google gave no review form", async () => {
    vi.mocked(createReviewLink).mockRejectedValue(
      new ApiError(
        409,
        "review_link_target_missing",
        "Google hasn't given this listing a review form yet."
      )
    )
    const response = await post()
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: "review_link_target_missing",
    })
  })
})

describe("a viewer (no edit action at the location)", () => {
  beforeEach(() => {
    asRole("viewer")
    vi.mocked(requireLocationAction).mockRejectedValue(denied())
  })

  it("is refused 403 on POST and creates nothing", async () => {
    const response = await post({ caption: "Hi" })
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: "permission_denied",
    })
    expect(createReviewLink).not.toHaveBeenCalled()
  })

  it("is refused 403 on PATCH and changes nothing", async () => {
    const response = await patch({ action: "rotate" })
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: "permission_denied",
    })
    expect(updateReviewLink).not.toHaveBeenCalled()
  })

  it("may still read the link", async () => {
    expect((await get()).status).toBe(200)
  })
})

describe("PATCH /api/locations/[id]/review-link", () => {
  it.each([
    { action: "rotate" },
    { action: "disable" },
    { action: "enable" },
    { action: "sync_target" },
    { action: "caption", caption: "Leave us a review" },
    { action: "caption", caption: null },
  ])("passes $action through to the service", async (action) => {
    const response = await patch(action)
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    await expect(response.json()).resolves.toEqual({ reviewLink: state })
    expect(requireLocationAction).toHaveBeenCalledWith(
      dummySql,
      expect.anything(),
      LOCATION,
      "edit",
      REVIEW_LINK_LOCATION_NOT_FOUND
    )
    expect(updateReviewLink).toHaveBeenCalledTimes(1)
    expect(updateReviewLink).toHaveBeenCalledWith(
      dummySql,
      expect.objectContaining({
        locationId: LOCATION,
        baseUrl: BASE_URL,
        action,
        requestId: expect.any(String),
      })
    )
  })

  it.each([
    { action: "delete" },
    {},
    { action: "caption" },
    { action: "caption", caption: "x".repeat(501) },
  ])("refuses %o with 400 and changes nothing", async (body) => {
    const response = await patch(body)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_request",
    })
    expect(updateReviewLink).not.toHaveBeenCalled()
  })

  it("returns the service's 422 for a gating caption", async () => {
    vi.mocked(updateReviewLink).mockRejectedValue(
      new ApiError(
        422,
        "review_link_caption_rejected",
        "Captions can't ask only happy guests for a review."
      )
    )
    const response = await patch({
      action: "caption",
      caption: "Loved it? Leave us 5 stars!",
    })
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      error: "review_link_caption_rejected",
    })
  })
})

describe("GET /api/locations/[id]/review-link/stats", () => {
  it("defaults to the last 30 days", async () => {
    const response = await getStats()
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    await expect(response.json()).resolves.toEqual({ stats: stats(30) })
    expect(requireLocationAccess).toHaveBeenCalledWith(
      dummySql,
      expect.anything(),
      LOCATION,
      REVIEW_LINK_LOCATION_NOT_FOUND
    )
    expect(readReviewLinkStats).toHaveBeenCalledWith(dummySql, LOCATION, 30)
  })

  it("reads 90 days for ?days=90", async () => {
    const response = await getStats("?days=90")
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ stats: stats(90) })
    expect(readReviewLinkStats).toHaveBeenCalledWith(dummySql, LOCATION, 90)
  })

  it.each(["?days=7", "?days=abc"])("refuses %s with 400", async (query) => {
    const response = await getStats(query)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_request",
    })
    expect(readReviewLinkStats).not.toHaveBeenCalled()
  })

  it("is a 404 for a location the caller cannot see", async () => {
    vi.mocked(requireLocationAccess).mockRejectedValue(hidden())
    const response = await getStats()
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: "location_not_found",
    })
    expect(readReviewLinkStats).not.toHaveBeenCalled()
  })

  it("refuses an id that is not a uuid with 400", async () => {
    expect((await getStats("", "nope")).status).toBe(400)
  })
})
