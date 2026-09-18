import "server-only"

import {
  dehydrate,
  QueryClient,
  type DehydratedState,
  type QueryKey,
} from "@tanstack/react-query"
import type { ZodType } from "zod"

import {
  analyticsOverviewSchema,
  type AnalyticsOverview,
} from "@/lib/contracts/analytics"
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
  reviewCountsSchema,
  type ReviewCounts,
} from "@/lib/contracts/reviews"
import { queryKeys } from "@/lib/queries/keys"
import { makeQueryClient } from "@/lib/queries/query-client"
import { loadAnalyticsOverview } from "@/lib/server/analytics-overview"
import {
  locationCapabilities,
  settingsCapabilities,
} from "@/lib/server/capabilities"
import { withTenant } from "@/lib/server/db"
import { readListingSummaries } from "@/lib/server/location-summary"
import { log } from "@/lib/server/logger"
import { readReviewCounts as loadReviewCounts } from "@/lib/server/review-counts"
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
 * What `useReviewCounts(locationId)` fetches.
 *
 * Delegates to `lib/server/review-counts.ts`, the one implementation the
 * route also calls: the counts hydrated into the cache on first paint and the
 * counts a later refetch returns must be produced the same way, or the rail
 * flickers between two different truths.
 */
export async function readReviewCounts(
  session: Session,
  locationId?: string
): Promise<ReviewCounts> {
  const counts = await withTenant(session.organisationId, (sql) =>
    loadReviewCounts(sql, session, locationId ? { locationId } : {})
  )
  return throughWire(reviewCountsSchema, counts)
}

/** What `useAnalyticsOverview()` (no params, last 30 days) fetches. */
export async function readAnalyticsOverview(
  session: Session
): Promise<AnalyticsOverview> {
  const overview = await withTenant(session.organisationId, (sql) =>
    loadAnalyticsOverview(sql, session, { granularity: "day" })
  )
  return throughWire(analyticsOverviewSchema, overview)
}

/** What `useLocationCapabilities(id)` fetches. */
export async function readLocationCapabilities(
  session: Session,
  locationId: string
): Promise<LocationCapabilities> {
  const payload = {
    capabilities: await withTenant(session.organisationId, (sql) =>
      locationCapabilities(sql, session, locationId)
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

/** What `useSettingsCapabilities()` fetches. Pure role projection. */
export function readSettingsCapabilities(
  session: Session
): SettingsCapabilities {
  const payload = {
    capabilities: settingsCapabilities(session),
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

/** /inbox Today strip: organisation-wide counts and the 30-day analytics overview. */
export function inboxPrefetch(): (session: Session) => PrefetchEntry[] {
  return (session) => [
    {
      queryKey: queryKeys.reviewCounts("organisation"),
      load: () => readReviewCounts(session),
    },
    {
      queryKey: queryKeys.analytics("overview", { window: "last-30-days" }),
      load: () => readAnalyticsOverview(session),
    },
  ]
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
      load: async () => readSettingsCapabilities(session),
    },
  ]
}
