import { beforeEach, describe, expect, it, vi } from "vitest"

import { getDatabase, withTenant } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"
import { invalidatePauseCache } from "@/lib/server/pause-controls"
import {
  executePublish,
  executeReplyDelete,
  retryPublishAttempt,
} from "@/lib/server/publishing"
import type { Session } from "@/lib/server/session"

// The reply pipeline's dispatch half of an operator pause
// (lib/server/pause-controls.ts): with PUBLISH_ENABLED on and the `publish`
// row paused, nothing is claimed, written or sent.

vi.mock("@/lib/server/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/db")>()),
  getDatabase: vi.fn(),
  withTenant: vi.fn(),
}))
vi.mock("@/lib/server/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/env")>()),
  getServerEnv: () => ({ PUBLISH_ENABLED: true }),
}))

/** A pause table answering `select scope ... where paused` with `scopes`. */
function pauseTable(scopes: string[] | Error) {
  vi.mocked(getDatabase).mockReturnValue((() =>
    scopes instanceof Error
      ? Promise.reject(scopes)
      : Promise.resolve(scopes.map((scope) => ({ scope })))) as never)
}

const session = { organisationId: "org", userId: "user" } as Session

beforeEach(() => {
  vi.mocked(withTenant).mockReset()
  vi.mocked(withTenant).mockRejectedValue(new Error("must not be reached"))
  invalidatePauseCache()
})

describe("reply pipeline under a table pause", () => {
  it("skips a retry claimed just before the pause without claiming it", async () => {
    pauseTable(["publish"])
    await expect(retryPublishAttempt("org", "attempt")).resolves.toBe("skipped")
    expect(withTenant).not.toHaveBeenCalled()
  })

  it("skips a retry when the pause table cannot be read", async () => {
    pauseTable(new Error("connection refused"))
    await expect(retryPublishAttempt("org", "attempt")).resolves.toBe("skipped")
    expect(withTenant).not.toHaveBeenCalled()
  })

  it.each([
    [
      "publish",
      () =>
        executePublish({
          organisationId: "org",
          session,
          reviewId: "review",
          draftId: "draft",
          expectedReviewUpdateTime: "2026-10-10T00:00:00Z",
          requestId: "req",
        }),
    ],
    [
      "delete",
      () =>
        executeReplyDelete({
          organisationId: "org",
          session,
          reviewId: "review",
          requestId: "req",
        }),
    ],
  ])("refuses a %s with publishing_paused before phase one", async (_, run) => {
    pauseTable(["publish"])
    const error = await run().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 503,
      code: "publishing_paused",
      details: { pausedScopes: ["publish"], pauseStateUnknown: false },
    })
    expect(withTenant).not.toHaveBeenCalled()
  })
})
