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
  administrationResponseSchema,
  type AdministrationResponse,
  type AdministrationState,
} from "@/lib/contracts/location-administration"
import {
  businessInformationResponseSchema,
  type BusinessInformationResponse,
  type BusinessInformationState,
} from "@/lib/contracts/location-business-information"
import {
  foodMenusResponseSchema,
  type FoodMenusResponse,
  type FoodMenusState,
} from "@/lib/contracts/location-food-menus"
import {
  hoursResponseSchema,
  type HoursResponse,
  type HoursState,
} from "@/lib/contracts/location-hours"
import {
  industryResponseSchema,
  type IndustryResponse,
  type IndustryState,
} from "@/lib/contracts/location-industry"
import {
  mediaListResponseSchema,
  type MediaOwnership,
  type MediaState,
} from "@/lib/contracts/location-media"
import type { GoogleMediaCategory } from "@/lib/domain/google-contract"
import {
  placeActionsResponseSchema,
  type PlaceActionsResponse,
  type PlaceActionsState,
} from "@/lib/contracts/location-place-actions"
import {
  postsListResponseSchema,
  type PostsListResponse,
} from "@/lib/contracts/location-posts"
import {
  profileResponseSchema,
  type ProfileResponse,
  type ProfileState,
} from "@/lib/contracts/location-profile"
import {
  decodeReviewsQuery,
  encodeReviewsCursor,
  encodeReviewsQuery,
  REVIEW_WORKFLOW_STATES,
  reviewCountsSchema,
  reviewsPageSchema,
  type ReviewCapabilities,
  type ReviewCounts,
  type ReviewsFilters,
  type ReviewsPage,
  type ReviewWorkflowState,
} from "@/lib/contracts/reviews"
import { parseInboxState, toReviewsFilters } from "@/lib/inbox/url-state"
import { parsePhotosState, toMediaQuery } from "@/lib/locations/photos-url-state"
import { DEFAULT_MEDIA_PAGE_SIZE } from "@/lib/media-page"
import { queryKeys } from "@/lib/queries/keys"
import { makeQueryClient } from "@/lib/queries/query-client"
import { loadAnalyticsOverview } from "@/lib/server/analytics-overview"
import { loadBusinessInformation } from "@/lib/server/business-information"
import {
  locationCapabilities,
  reviewCapabilitiesForLocations,
  settingsCapabilities,
} from "@/lib/server/capabilities"
import { withTenant } from "@/lib/server/db"
import { getFoodMenusState } from "@/lib/server/food-menus"
import { getHoursState } from "@/lib/server/hours"
import { loadIndustryManagement } from "@/lib/server/industry-management"
import { loadLocationAdministration } from "@/lib/server/location-administration"
import { log } from "@/lib/server/logger"
import { loadMedia } from "@/lib/server/media"
import {
  isManagerialRole,
  requireLocationAccess,
  visibilityPredicate,
} from "@/lib/server/permissions"
import { loadPlaceActions } from "@/lib/server/place-actions"
import { listLocalPosts } from "@/lib/server/posts"
import { getProfileState } from "@/lib/server/profile"
import { buildInboxQuery, type InboxQueryRow } from "@/lib/server/reviews-query"
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

/** The cache shape `useInfiniteQuery` expects for a single first page. */
export function firstPage<T>(page: T): InfiniteData<T, string | null> {
  return { pages: [page], pageParams: [null] }
}

// ---------------------------------------------------------------------------
// Readers — one per GET route the dashboard hooks call on mount
// ---------------------------------------------------------------------------

const NO_REVIEW_CAPABILITIES = {
  canPublish: false,
  canEdit: false,
  canRequestApproval: false,
} satisfies ReviewCapabilities

/**
 * Page assembly shared with GET /api/reviews (app/api/reviews/route.ts):
 * `pageSize + 1` rows in, `pageSize` items and a keyset cursor out. Kept as
 * a pure function so the unit test can prove Dates reach the cache as the
 * ISO strings `reviewRowSchema` demands.
 */
export function reviewsPageFromRows(
  rows: (InboxQueryRow & { capabilities: ReviewCapabilities })[],
  pageSize: number
): ReviewsPage {
  const hasMore = rows.length > pageSize
  const items = hasMore ? rows.slice(0, pageSize) : rows
  const last = items.at(-1)
  const nextCursor =
    hasMore && last
      ? encodeReviewsCursor({
          updateTime:
            last.updateTime instanceof Date
              ? last.updateTime.toISOString()
              : last.updateTime,
          id: last.id,
          rating: last.rating,
        })
      : null
  return throughWire(reviewsPageSchema, { items, nextCursor })
}

/** First page of the inbox list for `filters` — what `useReviews` fetches. */
export async function readReviewsPage(
  session: Session,
  filters: ReviewsFilters
): Promise<ReviewsPage> {
  // Encode → decode through the contract codec so defaults (sort, pageSize)
  // and the replyState narrowing match the route byte for byte.
  const query = decodeReviewsQuery(encodeReviewsQuery(filters))
  const rows = await withTenant(session.organisationId, async (sql) => {
    const queried = await buildInboxQuery(sql, {
      ...query,
      role: session.role,
      userId: session.userId,
    })
    const capabilities = await reviewCapabilitiesForLocations(
      sql,
      session,
      queried.map((row) => row.location.id)
    )
    return queried.map((row) => ({
      ...row,
      capabilities:
        capabilities.get(row.location.id) ?? NO_REVIEW_CAPABILITIES,
    }))
  })
  return reviewsPageFromRows(rows, query.pageSize)
}

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

export async function readHours(
  session: Session,
  locationId: string
): Promise<HoursState> {
  const payload = {
    hours: await getHoursState(session, locationId),
  } satisfies HoursResponse
  return throughWire(hoursResponseSchema, payload).hours
}

export async function readProfile(
  session: Session,
  locationId: string
): Promise<ProfileState> {
  const payload = {
    profile: await getProfileState(session, locationId),
  } satisfies ProfileResponse
  return throughWire(profileResponseSchema, payload).profile
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

/** One photos page — what `useMedia(id, query)` fetches for the same query. */
export async function readMedia(
  session: Session,
  locationId: string,
  query: {
    page: number
    category: GoogleMediaCategory | null
    ownership: MediaOwnership | null
  }
): Promise<MediaState> {
  const payload = {
    media: await loadMedia(session.organisationId, session, locationId, {
      page: query.page,
      pageSize: DEFAULT_MEDIA_PAGE_SIZE,
      category: query.category ?? undefined,
      ownership: query.ownership ?? undefined,
    }),
  }
  return throughWire(mediaListResponseSchema, payload).media
}

export async function readPlaceActions(
  session: Session,
  locationId: string
): Promise<PlaceActionsState> {
  const payload = {
    placeActions: await loadPlaceActions(
      session.organisationId,
      session,
      locationId
    ),
  } satisfies PlaceActionsResponse
  return throughWire(placeActionsResponseSchema, payload).placeActions
}

export async function readFoodMenus(
  session: Session,
  locationId: string
): Promise<FoodMenusState> {
  const payload = {
    foodMenus: await getFoodMenusState(session, locationId),
  } satisfies FoodMenusResponse
  return throughWire(foodMenusResponseSchema, payload).foodMenus
}

export async function readBusinessInformation(
  session: Session,
  locationId: string
): Promise<BusinessInformationState> {
  const payload = {
    businessInformation: await loadBusinessInformation(session, locationId),
  } satisfies BusinessInformationResponse
  return throughWire(businessInformationResponseSchema, payload)
    .businessInformation
}

export async function readIndustry(
  session: Session,
  locationId: string
): Promise<IndustryState> {
  const payload = {
    industry: await loadIndustryManagement(session, locationId),
  } satisfies IndustryResponse
  return throughWire(industryResponseSchema, payload).industry
}

export async function readAdministration(
  session: Session,
  locationId: string
): Promise<AdministrationState> {
  const payload = {
    administration: await loadLocationAdministration(session, locationId),
  } satisfies AdministrationResponse
  return throughWire(administrationResponseSchema, payload).administration
}

// ---------------------------------------------------------------------------
// Page composers
// ---------------------------------------------------------------------------

/** Next's awaited `searchParams` prop → the URLSearchParams the client reads. */
export function toSearchParams(
  params: Record<string, string | string[] | undefined>
): URLSearchParams {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((item) => search.append(key, item))
    else if (value !== undefined) search.set(key, value)
  }
  return search
}

/**
 * /inbox: the first review page for the URL's filters (rows carry their
 * review capabilities) and the counts for the URL's location scope. The
 * connection health, session and location directory it also reads are
 * hydrated by the dashboard layout.
 */
export function inboxPrefetch(
  searchParams: URLSearchParams
): (session: Session) => PrefetchEntry[] {
  const state = parseInboxState(searchParams)
  const filters = toReviewsFilters(state)
  return (session) => [
    {
      queryKey: queryKeys.reviews("organisation", filters),
      load: async () => firstPage(await readReviewsPage(session, filters)),
    },
    {
      queryKey: queryKeys.reviewCounts(state.locationId ?? "organisation"),
      load: () => readReviewCounts(session, state.locationId),
    },
  ]
}

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

const TAB_ENTRY: Record<
  LocationTabKey,
  (
    session: Session,
    locationId: string,
    search: URLSearchParams
  ) => PrefetchEntry
> = {
  profile: (session, id) => ({
    queryKey: queryKeys.locationProfile(id),
    load: () => readProfile(session, id),
  }),
  hours: (session, id) => ({
    queryKey: queryKeys.locationHours(id),
    load: () => readHours(session, id),
  }),
  posts: (session, id) => ({
    queryKey: queryKeys.locationPosts(id),
    load: () => readPosts(session, id),
  }),
  photos: (session, id, search) => {
    // PhotosTab reads page/ownership/category from the URL, so the key must
    // come from the same parser or a filtered reload would miss the cache.
    const query = toMediaQuery(parsePhotosState(search))
    return {
      queryKey: queryKeys.locationMedia(id, query),
      load: () => readMedia(session, id, query),
    }
  },
  booking: (session, id) => ({
    queryKey: queryKeys.locationBooking(id),
    load: () => readPlaceActions(session, id),
  }),
  menu: (session, id) => ({
    queryKey: queryKeys.locationMenu(id),
    load: () => readFoodMenus(session, id),
  }),
  businessInformation: (session, id) => ({
    queryKey: queryKeys.locationBusinessInformation(id),
    load: () => readBusinessInformation(session, id),
  }),
  industry: (session, id) => ({
    queryKey: queryKeys.locationIndustry(id),
    load: () => readIndustry(session, id),
  }),
  administration: (session, id) => ({
    queryKey: queryKeys.locationAdministration(id),
    load: () => readAdministration(session, id),
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
  tab: LocationTabKey,
  search: URLSearchParams = new URLSearchParams()
): (session: Session) => PrefetchEntry[] {
  return (session) => {
    if (!locationId) return []
    const entries: PrefetchEntry[] = [
      {
        queryKey: queryKeys.locationCapabilities(locationId),
        load: () => readLocationCapabilities(session, locationId),
      },
    ]
    if (!MANAGERIAL_TABS.has(tab) || isManagerialRole(session.role)) {
      entries.push(TAB_ENTRY[tab](session, locationId, search))
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
