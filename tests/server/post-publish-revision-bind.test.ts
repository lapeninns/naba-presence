import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/server/http"
import { requestOrPublishLocalPost } from "@/lib/server/posts"
import type { Session } from "@/lib/server/session"

/**
 * Publish is bound to the revision the person saved. A post whose last
 * publish never settled (`ambiguous`) is first reconciled against Google's
 * list, outside the deciding transaction, and decided again. An edit can
 * land in that gap, so the second pass must refuse as the first would: a 409,
 * and nothing sent to Google. The database layer is mocked; the
 * database-backed cases are tests/integration/routes/post-two-person.test.ts.
 */

const db = vi.hoisted(() => ({
  post: {} as Record<string, unknown>,
  onReconcile: () => {},
}))

vi.mock("@/lib/server/db", () => ({
  jsonColumn: (value: unknown) => value,
  jsonColumnOrNull: (value: unknown) => value,
  withTenant: async (
    _organisationId: string,
    work: (sql: unknown) => unknown
  ) => {
    // A tagged-template stand-in: the post row for the locked read, nothing
    // for every other statement.
    const sql = (strings: TemplateStringsArray) => {
      const text = strings.join("?")
      const isPostRead =
        text.includes("from gbp_local_post p") &&
        text.includes("join organisation")
      return Promise.resolve(isPostRead ? [{ ...db.post }] : [])
    }
    return work(sql)
  },
}))
vi.mock("@/lib/server/permissions", () => ({
  requireLocationAccess: vi.fn(),
  requireLocationAction: vi.fn(async () => ({ canPublish: true })),
}))
vi.mock("@/lib/server/pause-controls", () => ({
  loadPauseSnapshot: vi.fn(async () => ({})),
  requireGbpDispatch: vi.fn(async () => undefined),
}))
vi.mock("@/lib/server/gbp-write", () => ({
  idempotencyKey: vi.fn(),
  loadLinkedLocation: vi.fn(async () => ({
    accessToken: async () => "token",
    googleAccountName: "accounts/1",
    googleLocationName: "locations/1",
    googleConnectionId: "connection-1",
  })),
  requireGbpWrite: vi.fn(),
  requirePublishGrant: vi.fn(),
  runGbpWrite: vi.fn(),
}))
vi.mock("@/lib/server/google", () => ({
  // The reconcile reads Google's list; that is where the edit lands.
  googleLocalPosts: vi.fn(async () => {
    db.onReconcile()
    return { localPosts: [] }
  }),
  createGoogleLocalPost: vi.fn(),
  deleteGoogleLocalPost: vi.fn(),
  getGoogleLocalPost: vi.fn(),
  patchGoogleLocalPost: vi.fn(),
}))
vi.mock("@/lib/server/resource-observations", () => ({
  forgetObservedGooglePayload: vi.fn(),
  readObservedGooglePayload: vi.fn(),
  recordResourceObservation: vi.fn(),
}))
vi.mock("@/lib/server/publication-schedules", () => ({
  invalidateSourceSchedules: vi.fn(),
  lockSourceSchedules: vi.fn(),
}))

const google = await import("@/lib/server/google")
const gbpWrite = await import("@/lib/server/gbp-write")

const session = {
  sessionId: "00000000-0000-4000-8000-000000000010",
  userId: "00000000-0000-4000-8000-000000000002",
  organisationId: "00000000-0000-4000-8000-000000000001",
  organisationName: "Org",
  workspaceMode: "business",
  displayName: "Owner",
  email: "owner@example.test",
  role: "owner",
  canPublish: true,
  aal: "aal1",
  mfaFactorId: null,
  mfaVerifiedAt: null,
  mfaProofExpiresAt: null,
  securityVersion: 1,
  mfaFactorCount: 1,
} as Session

const input = {
  organisationId: session.organisationId,
  session,
  locationId: "11111111-1111-4111-8111-111111111111",
  postId: "22222222-2222-4222-8222-222222222222",
  requestId: "request-1",
}

function ambiguousPost(contentRevision: number) {
  return {
    id: input.postId,
    locationId: input.locationId,
    externalLocationId: "locations/1",
    googlePostName: null,
    status: "ambiguous",
    topicType: "STANDARD",
    languageCode: "en",
    summary: "Fresh seasonal menu",
    callToAction: null,
    event: null,
    offer: null,
    media: null,
    approvalRequestedBy: null,
    contentRevision,
    approvalRequestedRevision: null,
    authorId: session.userId,
    requireTwoPersonApproval: false,
  }
}

describe("requestOrPublishLocalPost: publish is bound to the saved revision", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.post = ambiguousPost(3)
    db.onReconcile = () => {}
  })

  it("refuses with 409 after the reconcile when an edit landed between the two passes, and sends nothing to Google", async () => {
    // The first pass sees revision 3, as the person saved it, and settles the
    // post from Google's list. While that list is read, another editor saves
    // revision 4 and the post is a draft again.
    db.onReconcile = () => {
      db.post = { ...ambiguousPost(4), status: "draft" }
    }

    const outcome = await requestOrPublishLocalPost({
      ...input,
      expectedRevision: 3,
    }).then(
      () => null,
      (error: unknown) => error
    )

    expect(outcome).toBeInstanceOf(ApiError)
    expect(outcome).toMatchObject({
      status: 409,
      code: "post_changed_since_saved",
    })
    // The reconcile ran (the first pass did not refuse), and then the second
    // pass refused before any write.
    expect(google.googleLocalPosts).toHaveBeenCalledTimes(1)
    expect(google.createGoogleLocalPost).not.toHaveBeenCalled()
    expect(google.patchGoogleLocalPost).not.toHaveBeenCalled()
    expect(gbpWrite.runGbpWrite).not.toHaveBeenCalled()
  })

  it("refuses on the first pass, before any reconcile or Google call, when the post already moved on", async () => {
    db.post = ambiguousPost(4)

    await expect(
      requestOrPublishLocalPost({ ...input, expectedRevision: 3 })
    ).rejects.toMatchObject({ status: 409, code: "post_changed_since_saved" })

    expect(google.googleLocalPosts).not.toHaveBeenCalled()
    expect(google.createGoogleLocalPost).not.toHaveBeenCalled()
    expect(gbpWrite.runGbpWrite).not.toHaveBeenCalled()
  })
})
