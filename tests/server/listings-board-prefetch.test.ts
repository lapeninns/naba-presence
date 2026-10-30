import { describe, expect, it, vi } from "vitest"

import {
  emptyListingSummary,
  listingSummariesResponseSchema,
} from "@/lib/contracts/location-summary"
import type { ListingCompleteness } from "@/lib/listings/completeness"
import { queryKeys } from "@/lib/queries/keys"
import { makeQueryClient } from "@/lib/queries/query-client"
import {
  listingOverviewPrefetch,
  listingsBoardPrefetch,
  prefetch,
} from "@/lib/server/prefetch"
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
vi.mock("@/lib/server/listing-completeness", () => ({
  readListingCompleteness: vi.fn(),
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

// The board's Completeness column and the overview's card hydrate from the
// reader `?view=completeness` calls, under the keys their hooks read, so
// they paint on first load. The default summary read is untouched.
const completeness: ListingCompleteness = {
  locationId: LOCATION,
  score: 82,
  fixPoints: 2,
  counts: { fail: 1, unknown: 0, pass: 17, not_applicable: 1, skipped: 0 },
  checks: [
    {
      id: "phone",
      title: "Phone number",
      importance: "necessary",
      status: "fail",
      detail: "No phone number on Google",
      fix: {
        label: "Add a phone number",
        href: `/listings/${LOCATION}/profile`,
      },
    },
  ],
}

describe("completeness prefetch", () => {
  it("hydrates every visible listing's completeness beside the board's summaries", async () => {
    const { readListingSummaries } =
      await import("@/lib/server/location-summary")
    const { readListingCompleteness } =
      await import("@/lib/server/listing-completeness")
    vi.mocked(readListingSummaries).mockResolvedValueOnce([])
    vi.mocked(readListingCompleteness).mockResolvedValueOnce([completeness])
    const client = makeQueryClient()
    await prefetch(owner, listingsBoardPrefetch(), client)
    // Every listing: no ids.
    expect(readListingCompleteness).toHaveBeenCalledWith(SQL, owner)
    // The summaries' own read is unchanged.
    expect(readListingSummaries).toHaveBeenCalledWith(SQL, owner)
    expect(client.getQueryData(queryKeys.listingCompletenessBoard)).toEqual([
      completeness,
    ])
  })

  it("keeps the summaries when the completeness read fails", async () => {
    const { readListingSummaries } =
      await import("@/lib/server/location-summary")
    const { readListingCompleteness } =
      await import("@/lib/server/listing-completeness")
    vi.mocked(readListingSummaries).mockResolvedValueOnce([])
    vi.mocked(readListingCompleteness).mockRejectedValueOnce(
      new Error("db down")
    )
    const client = makeQueryClient()
    await prefetch(owner, listingsBoardPrefetch(), client)
    expect(client.getQueryData(queryKeys.listingSummaries)).toEqual([])
    expect(
      client.getQueryData(queryKeys.listingCompletenessBoard)
    ).toBeUndefined()
  })

  it("hydrates one listing's completeness for its overview, as the hook holds it", async () => {
    const { readListingCompleteness } =
      await import("@/lib/server/listing-completeness")
    vi.mocked(readListingCompleteness).mockResolvedValueOnce([completeness])
    const client = makeQueryClient()
    await prefetch(owner, listingOverviewPrefetch(LOCATION), client)
    expect(readListingCompleteness).toHaveBeenCalledWith(SQL, owner, [LOCATION])
    expect(
      client.getQueryData(queryKeys.listingCompleteness(LOCATION))
    ).toEqual(completeness)
  })

  it("hydrates null for a listing the session can't see, as the hook does", async () => {
    const { readListingCompleteness } =
      await import("@/lib/server/listing-completeness")
    vi.mocked(readListingCompleteness).mockResolvedValueOnce([])
    const client = makeQueryClient()
    await prefetch(owner, listingOverviewPrefetch(LOCATION), client)
    expect(
      client.getQueryData(queryKeys.listingCompleteness(LOCATION))
    ).toBeNull()
  })
})
