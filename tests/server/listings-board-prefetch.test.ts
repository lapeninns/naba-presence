import { describe, expect, it, vi } from "vitest"

import {
  emptyListingSummary,
  listingSummariesResponseSchema,
} from "@/lib/contracts/location-summary"
import { queryKeys } from "@/lib/queries/keys"
import { makeQueryClient } from "@/lib/queries/query-client"
import { listingsBoardPrefetch, prefetch } from "@/lib/server/prefetch"
import type { Session } from "@/lib/server/session"

// AMA-146: /listings hydrates the board's summaries, so its health pills are
// in the first HTML. The reader is the one `/api/listings/summary` calls;
// this pins the key `useListingSummaries()` reads and the wire shape.
const SQL = { tag: "tenant-sql" }
vi.mock("@/lib/server/db", () => ({
  withTenant: vi.fn(async (_org: string, fn: (sql: unknown) => unknown) =>
    fn(SQL)
  ),
}))
vi.mock("@/lib/server/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/server/location-summary", () => ({
  readListingSummaries: vi.fn(),
}))

const owner: Session = {
  sessionId: "00000000-0000-4000-8000-000000000020",
  userId: "00000000-0000-4000-8000-000000000002",
  organisationId: "00000000-0000-4000-8000-000000000001",
  organisationName: "Org",
  workspaceMode: "agency",
  displayName: "Test",
  email: "test@example.test",
  role: "owner",
  canPublish: true,
}
const LOCATION = "00000000-0000-4000-8000-000000000030"

describe("listingsBoardPrefetch", () => {
  it("hydrates every visible summary under the board's key, as the route returns it", async () => {
    const { readListingSummaries } =
      await import("@/lib/server/location-summary")
    const summary = emptyListingSummary({
      locationId: LOCATION,
      linked: true,
      verified: true,
    })
    vi.mocked(readListingSummaries).mockResolvedValueOnce([summary])
    const client = makeQueryClient()
    await prefetch(owner, listingsBoardPrefetch(), client)
    expect(readListingSummaries).toHaveBeenCalledWith(SQL, owner)
    expect(client.getQueryData(queryKeys.listingSummaries)).toEqual(
      listingSummariesResponseSchema.parse(
        JSON.parse(JSON.stringify({ summaries: [summary] }))
      ).summaries
    )
  })

  it("leaves the board to fetch for itself when the read fails", async () => {
    const { readListingSummaries } =
      await import("@/lib/server/location-summary")
    vi.mocked(readListingSummaries).mockRejectedValueOnce(new Error("db down"))
    const client = makeQueryClient()
    await prefetch(owner, listingsBoardPrefetch(), client)
    expect(client.getQueryData(queryKeys.listingSummaries)).toBeUndefined()
  })
})
