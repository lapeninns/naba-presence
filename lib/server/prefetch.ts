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
  locationCapabilitiesResponseSchema,
  settingsCapabilitiesResponseSchema,
  type LocationCapabilities,
  type LocationCapabilitiesResponse,
  type SettingsCapabilities,
  type SettingsCapabilitiesResponse,
} from "@/lib/contracts/location-capabilities"
import {
  postsListResponseSchema,
  type PostsListResponse,
} from "@/lib/contracts/location-posts"
import {
  REVIEW_WORKFLOW_STATES,
  reviewCountsSchema,
  type ReviewCapabilities,
  type ReviewCounts,
  type ReviewWorkflowState,
} from "@/lib/contracts/reviews"
import { queryKeys } from "@/lib/queries/keys"
import { makeQueryClient } from "@/lib/queries/query-client"
import { loadAnalyticsOverview } from "@/lib/server/analytics-overview"
import {
  locationCapabilities,
  settingsCapabilities,
} from "@/lib/server/capabilities"
import { withTenant } from "@/lib/server/db"
import { log } from "@/lib/server/logger"
import {
  isManagerialRole,
  requireLocationAccess,
  visibilityPredicate,
} from "@/lib/server/permissions"
import { listLocalPosts } from "@/lib/server/posts"
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

/** Count aggregation shared with GET /api/reviews/counts. Pure; tested. */
export function reviewCountsFromRows(
  rows: { workflowStatus: ReviewWorkflowState; count: number }[]
): ReviewCounts {
  const byStatus = Object.fromEntries(
    REVIEW_WORKFLOW_STATES.map((status) => [status, 0])
  ) as Record<ReviewWorkflowState, number>
  for (const row of rows) byStatus[row.workflowStatus] = row.count
  return throughWire(reviewCountsSchema, {
    total: rows.reduce((total, row) => total + row.count, 0),
    byStatus,
  } satisfies ReviewCounts)
}

/** What `useReviewCounts(locationId)` fetches. */
export async function readReviewCounts(
  session: Session,
  locationId?: string
): Promise<ReviewCounts> {
  const rows = await withTenant(session.organisationId, async (sql) => {
    if (locationId) await requireLocationAccess(sql, session, locationId)
    return sql<{ workflowStatus: ReviewWorkflowState; count: number }[]>`
      select
        r.workflow_status as "workflowStatus",
        count(*)::integer as count
      from review r
      where r.provider_deleted_at is null
        ${locationId ? sql`and r.location_id = ${locationId}` : sql``}
        and ${visibilityPredicate(sql, session, sql`r.location_id`)}
      group by r.workflow_status
    `
  })
  return reviewCountsFromRows(rows)
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

/** What `useSettingsCapabilities()` fetches. Pure role projection. */
export function readSettingsCapabilities(
  session: Session
): SettingsCapabilities {
  const payload = {
    capabilities: settingsCapabilities(session),
  } satisfies SettingsCapabilitiesResponse
  return throughWire(settingsCapabilitiesResponseSchema, payload).capabilities
}

export async function readPosts(
  session: Session,
  locationId: string
): Promise<PostsListResponse> {
  const payload = await listLocalPosts(
    session.organisationId,
    session,
    locationId
  )
  return throughWire(postsListResponseSchema, payload)
}

// ---------------------------------------------------------------------------
// Page composers
// ---------------------------------------------------------------------------

/** /home: organisation-wide counts and the 30-day analytics overview. */
export function homePrefetch(): (session: Session) => PrefetchEntry[] {
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

export type LocationTabKey =
  | "profile"
  | "hours"
  | "posts"
  | "photos"
  | "booking"
  | "menu"
  | "businessInformation"
  | "industry"
  | "administration"

// Google Business Information "console" surfaces. Their GET routes are
// owner/admin-only (industry, administration) or their capability is
// `permission_denied` for everyone else (businessInformation), and the
// LocationTab shell never mounts the resource hook for a gated viewer — so a
// member's prefetch would be a wasted (or 403) round-trip.
const MANAGERIAL_TABS: ReadonlySet<LocationTabKey> = new Set([
  "businessInformation",
  "industry",
  "administration",
])

// Only tabs whose reader is served from our own database are prefetched in
// the RSC render. The others (hours, profile, photos, booking, menu, business
// information, industry, administration) read Google live, which costs 3-5s
// per request inside the server render: first paint would wait on Google, and
// every `<Link prefetch>` to those pages would trigger the same cost. Those
// tabs hydrate capabilities only and fetch their state on the client as before.
const DB_BACKED_TABS: ReadonlySet<LocationTabKey> = new Set(["posts"])

const TAB_ENTRY: Partial<
  Record<
    LocationTabKey,
    (session: Session, locationId: string) => PrefetchEntry
  >
> = {
  posts: (session, id) => ({
    queryKey: queryKeys.locationPosts(id),
    load: () => readPosts(session, id),
  }),
}

/**
 * One per-location tab: its capabilities (every tab reads them, and the
 * LocationTab shell waits on them before mounting the resource hook — the
 * waterfall this removes) plus that tab's state. `search` is the page's URL
 * query, for tabs whose key depends on it (photos).
 */
export function locationTabPrefetch(
  locationId: string | null,
  tab: LocationTabKey
): (session: Session) => PrefetchEntry[] {
  return (session) => {
    if (!locationId) return []
    const entries: PrefetchEntry[] = [
      {
        queryKey: queryKeys.locationCapabilities(locationId),
        load: () => readLocationCapabilities(session, locationId),
      },
    ]
    const entry = TAB_ENTRY[tab]
    if (
      entry &&
      DB_BACKED_TABS.has(tab) &&
      (!MANAGERIAL_TABS.has(tab) || isManagerialRole(session.role))
    ) {
      entries.push(entry(session, locationId))
    }
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
