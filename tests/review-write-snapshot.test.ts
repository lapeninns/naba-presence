import { afterEach, describe, expect, it, vi } from "vitest"

import { readReviewWriteSnapshot } from "@/lib/server/review-reads"
import type { Session } from "@/lib/server/session"

afterEach(() => vi.restoreAllMocks())

// The write has already committed when the snapshot is read, so a failed
// read must not turn a published reply into an error response.
describe("readReviewWriteSnapshot", () => {
  it("leaves the snapshot out when the read fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const tenant = vi.fn(async () => {
      throw new Error("connection reset")
    }) as unknown as Parameters<typeof readReviewWriteSnapshot>[0]
    await expect(
      readReviewWriteSnapshot(tenant, {} as Session, "rev-1", "req-1")
    ).resolves.toEqual({})
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("review.write_snapshot_failed")
    )
  })
})
