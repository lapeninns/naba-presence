import "server-only"

import {
  dehydrate,
  QueryClient,
  type DehydratedState,
  type InfiniteData,
  type QueryKey,
} from "@tanstack/react-query"
import type { ZodType } from "zod"

import {
  listingSummarySchema,
  type ListingSummary,
} from "@/lib/contracts/location-summary"
import {
  locationCapabilitiesResponseSchema,
  settingsCapabilitiesResponseSchema,
  type LocationCapabilities,
  type LocationCapabilitiesResponse,
  type SettingsCapabilities,
  type SettingsCapabilitiesResponse,
} from "@/lib/contracts/location-capabilities"
import {
  decodeReviewsQuery,
  encodeReviewsQuery,
  reviewCountsQuerySchema,
  reviewCountsSchema,
  reviewDetailSchema,
  reviewIdParamsSchema,
  reviewsPageSchema,
  type ReviewCounts,
  type ReviewDetail,
  type ReviewsFilters,
  type ReviewsPage,
} from "@/lib/contracts/reviews"
import { parseInboxState, toReviewsFilters } from "@/lib/inbox/url-state"
import { queryKeys } from "@/lib/queries/keys"
import { makeQueryClient } from "@/lib/queries/query-client"
import {
  NO_SETTINGS_FEATURES,
  locationCapabilities,
  readSettingsFeatures,
  settingsCapabilities,
  settingsFeaturesApply,
} from "@/lib/server/capabilities"
import { withTenant } from "@/lib/server/db"
import { readListingSummaries } from "@/lib/server/location-summary"
import { log } from "@/lib/server/logger"
import { loadPauseSnapshot } from "@/lib/server/pause-controls"
import {
  readReviewCounts as loadReviewCounts,
  type ReviewCountsScope,
} from "@/lib/server/review-counts"
import {
  readReviewDetail as loadReviewDetail,
  readReviewsPage as loadReviewsPage,
} from "@/lib/server/review-reads"
import type { Session } from "@/lib/server/session"

/**
 * Server-side prefetch for the dashboard pages (Sprint 4.6).
 *
 * The pattern is the one app/(dashboard)/layout.tsx already uses for
 * connections, session and the location directory: a server QueryClient is
 * filled with `setQueryData` under the SAME keys the client hooks use
 * (lib/queries/keys.ts), dehydrated, and handed to a `<HydrationBoundary>`
 * around the page. The client hooks then find fresh data (staleTime 30s from
 * makeQueryClient) on their first render and issue no request.
 *
 * Two rules keep the hydrated cache indistinguishable from a fetched one:
 *
 * 1. Every `read*` helper calls the lib/server reader the API route calls,
 *    builds the route's response object under `satisfies <Response>` (so a
 *    reader/contract drift is a compile error, exactly as in the route), then
 *    pushes it through `throughWire`: a JSON round-trip plus the contract
 *    schema the `lib/api` parser uses. Dates become ISO strings, `undefined`
 *    members vanish, and the value that lands in the cache is byte-for-byte
 *    what `apiFetch` would have produced.
 * 2. `prefetch` never throws. A failed reader is logged and its key is left
 *    empty, so the client hook fetches as it always did and renders the
 *    route's error the way it always has. A prefetch is an optimisation, not
 *    a gate; the page must still render when Google is slow or down.
 *
 * Nothing here runs without a session: `prefetch(null, …)` returns an empty
 * dehydrated state, which `<HydrationBoundary>` treats as a no-op.
 */

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * A JSON round-trip followed by the contract parse — what the browser sees
 * after `NextResponse.json` and `apiFetch({ schema })`. Exported for tests.
 */
export function throughWire<T>(schema: ZodType<T>, payload: unknown): T {
  return schema.parse(JSON.parse(JSON.stringify(payload)))
}

export type PrefetchEntry = {
  queryKey: QueryKey
  load: () => Promise<unknown>
}

/**
 * Runs every entry concurrently, stores the successful ones under their
 * keys and returns the dehydrated state for a `<HydrationBoundary>`.
 * Failures are logged (`prefetch_failed`) and skipped — never thrown.
 */
export async function prefetch(
  session: Session | null,
  entries: PrefetchEntry[] | ((session: Session) => PrefetchEntry[]),
  client: QueryClient = makeQueryClient()
): Promise<DehydratedState> {
  if (!session) return dehydrate(client)
  const list = typeof entries === "function" ? entries(session) : entries
  const results = await Promise.allSettled(list.map((entry) => entry.load()))
  results.forEach((result, index) => {
    const { queryKey } = list[index]
    if (result.status === "fulfilled") {
      client.setQueryData(queryKey, result.value)
      return
    }
    const error = result.reason
    log.warn("prefetch_failed", {
      queryKey: JSON.stringify(queryKey),
      error: error instanceof Error ? error.message : String(error),
      code:
        error && typeof error === "object" && "code" in error
          ? String((error as { code: unknown }).code)
          : undefined,
    })
  })
  return dehydrate(client)
}

// ---------------------------------------------------------------------------
// Readers — one per GET route the dashboard hooks call on mount
// ---------------------------------------------------------------------------

/**
 * What `useReviewCounts(scope)` (and the shell's `useNeedsReplyCount`)
 * fetches.
 *
 * Delegates to `lib/server/review-counts.ts`, the one implementation the
 * route also calls: the counts hydrated into the cache on first paint and the
 * counts a later refetch returns must be produced the same way, or the rail
 * flickers between two different truths. The scope goes through the route's
 * own query schema, so an id the route would refuse is refused here too.
 */
export async function readReviewCounts(
  session: Session,
  scope: ReviewCountsScope = {}
): Promise<ReviewCounts> {
  const parsed = reviewCountsQuerySchema.parse(scope)
  const counts = await withTenant(session.organisationId, (sql) =>
    loadReviewCounts(sql, session, parsed)
  )
  return throughWire(reviewCountsSchema, counts)
}

/**
 * What `useReviews(filters)` holds after its first page: the infinite-query
 * shape (`initialPageParam` null) around what `GET /api/reviews` answers for
 * `filters`. The filters take the browser's path to the route, encoded to
 * the wire and decoded by the route's codec, so defaults (sort, page size)
 * and narrowing match the request `fetchReviews` would have sent.
 */
export async function readReviewsFirstPage(
  session: Session,
  filters: ReviewsFilters
): Promise<InfiniteData<ReviewsPage, string | null>> {
  const query = decodeReviewsQuery(
    encodeReviewsQuery({ ...filters, cursor: null })
  )
  const page = await withTenant(session.organisationId, (sql) =>
    loadReviewsPage(sql, session, query)
  )
  return { pages: [throughWire(reviewsPageSchema, page)], pageParams: [null] }
}

/** What `useReviewDetail(id)` fetches: `GET /api/reviews/{id}`. */
export async function readReviewDetail(
  session: Session,
  id: string
): Promise<ReviewDetail> {
  const review = await withTenant(session.organisationId, (sql) =>
    loadReviewDetail(sql, session, id)
  )
  return throughWire(reviewDetailSchema, { review })
}

/** What `useLocationCapabilities(id)` fetches. */
export async function readLocationCapabilities(
  session: Session,
  locationId: string
): Promise<LocationCapabilities> {
  // Read before the transaction, never inside it (lib/server/db.ts).
  const pauses = await loadPauseSnapshot()
  const payload = {
    capabilities: await withTenant(session.organisationId, (sql) =>
      locationCapabilities(sql, session, locationId, pauses)
    ),
  } satisfies LocationCapabilitiesResponse
  return throughWire(locationCapabilitiesResponseSchema, payload).capabilities
}

/** What `useListingSummary(id)` fetches: the DB-only listing state. */
export async function readListingSummary(
  session: Session,
  locationId: string
): Promise<ListingSummary | null> {
  const [summary] = await withTenant(session.organisationId, (sql) =>
    readListingSummaries(sql, session, [locationId])
  )
  return summary ? throughWire(listingSummarySchema, summary) : null
}

/**
 * What `useSettingsCapabilities()` fetches: a role projection plus the
 * organisation's settings feature switches, read in one tenant transaction
 * for an owner or admin and skipped for anyone else.
 */
export async function readSettingsCapabilities(
  session: Session
): Promise<SettingsCapabilities> {
  const features = settingsFeaturesApply(session)
    ? await withTenant(session.organisationId, (sql) =>
        readSettingsFeatures(sql, session)
      )
    : NO_SETTINGS_FEATURES
  const payload = {
    capabilities: settingsCapabilities(session, features),
  } satisfies SettingsCapabilitiesResponse
  return throughWire(settingsCapabilitiesResponseSchema, payload).capabilities
}

// ---------------------------------------------------------------------------
// Page composers
// ---------------------------------------------------------------------------

/**
 * A listing page: its capabilities and its DB-only summary. Both are pure
 * SQL, so the overview's health strip and cards, and an area page's status
 * pill, paint on the first render. The editors' own resources are NOT
 * prefetched: they read Google live (see `locationTabPrefetch`).
 */
export function listingPagePrefetch(
  locationId: string
): (session: Session) => PrefetchEntry[] {
  return (session) => [
    ...locationTabPrefetch(locationId)(session),
    {
      queryKey: queryKeys.listingSummary(locationId),
      load: () => readListingSummary(session, locationId),
    },
  ]
}

/**
 * /inbox: what the inbox's own hooks read on their first render for the
 * URL's query string, so the list (and an open `?selected=` review) is in
 * the first HTML instead of waiting for the client bundle.
 *
 * - the first page of `useReviews(filters)`, under the key built from the
 *   same `parseInboxState` → `toReviewsFilters` the view runs. A business
 *   has no client scope, so its `clientId` is dropped as the view drops it.
 *   An `age` preset is skipped: its window is relative to the hour it is
 *   read in, and a server and browser either side of the hour would key
 *   differently, rendering rows on one side and a skeleton on the other.
 * - the client-scoped counts `useReviewCounts({ clientId })` reads while
 *   the inbox is filtered to one client. The unscoped counts are hydrated
 *   by the dashboard layout for the shell's badges, which is the same key.
 * - the open review, under `useReviewDetail(selected)`'s key. A malformed
 *   id is left to the client, whose request the route refuses.
 */
export function inboxPrefetch(
  search: URLSearchParams
): (session: Session) => PrefetchEntry[] {
  return (session) => {
    const parsed = parseInboxState(search)
    const state =
      session.workspaceMode === "business"
        ? { ...parsed, clientId: undefined }
        : parsed
    const entries: PrefetchEntry[] = []
    if (!state.age || state.dateFrom || state.dateTo) {
      const filters = toReviewsFilters(state)
      entries.push({
        queryKey: queryKeys.reviews("organisation", filters),
        load: () => readReviewsFirstPage(session, filters),
      })
    }
    if (state.clientId) {
      const clientId = state.clientId
      entries.push({
        queryKey: queryKeys.reviewCounts(`organisation:${clientId}`),
        load: () => readReviewCounts(session, { clientId }),
      })
    }
    const selected = reviewIdParamsSchema.safeParse({ id: state.selected })
    if (selected.success) {
      const id = selected.data.id
      entries.push({
        queryKey: queryKeys.reviewDetail(id),
        load: () => readReviewDetail(session, id),
      })
    }
    return entries
  }
}

/**
 * One per-location tab: its capabilities only. Every tab reads them and the
 * LocationTab shell waits on them before mounting the resource hook, so this
 * removes that waterfall. Tab state itself is NOT prefetched: hours, profile,
 * photos, booking, menu, business profile, industry and administration
 * read Google live, and posts reconciles against Google on every list
 * (lib/server/posts.ts), so any of them inside the RSC render would gate first
 * paint (and every <Link prefetch> to the page) on Google for seconds. `search` is the page's URL
 * query, for tabs whose key depends on it (photos).
 */
export function locationTabPrefetch(
  locationId: string | null
): (session: Session) => PrefetchEntry[] {
  return (session) => {
    if (!locationId) return []
    const entries: PrefetchEntry[] = [
      {
        queryKey: queryKeys.locationCapabilities(locationId),
        load: () => readLocationCapabilities(session, locationId),
      },
    ]
    return entries
  }
}

/** /settings/*: the role projection PolicyForm and friends gate on. */
export function settingsPrefetch(): (session: Session) => PrefetchEntry[] {
  return (session) => [
    {
      queryKey: queryKeys.settingsCapabilities,
      load: () => readSettingsCapabilities(session),
    },
  ]
}
