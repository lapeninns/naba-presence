import "server-only"

import {
  dehydrate,
  QueryClient,
  type DehydratedState,
  type InfiniteData,
  type QueryKey,
} from "@tanstack/react-query"
import { z, type ZodType } from "zod"

import {
  invitationsResponseSchema,
  type InvitationsResponse,
} from "@/lib/contracts/invitations"
import {
  hoursResponseSchema,
  type HoursState,
} from "@/lib/contracts/location-hours"
import {
  mediaListQuerySchema,
  mediaListResponseSchema,
  type MediaState,
} from "@/lib/contracts/location-media"
import {
  postsListQuerySchema,
  postsListResponseSchema,
  type PostsListResponse,
} from "@/lib/contracts/location-posts"
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
  membersResponseSchema,
  type MembersResponse,
} from "@/lib/contracts/members"
import {
  notificationPreferencesResponseSchema,
  type NotificationPreferencesResponse,
} from "@/lib/contracts/operational-notifications"
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
import {
  settingsResponseSchema,
  type OrgSettings,
} from "@/lib/contracts/settings"
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
  importReviewListResponseSchema,
  type ImportReviewListResponse,
} from "@/lib/contracts/location-import-review"
import {
  placeActionsResponseSchema,
  type PlaceActionsResponse,
  type PlaceActionsState,
} from "@/lib/contracts/location-place-actions"
import {
  profileResponseSchema,
  type ProfileResponse,
  type ProfileState,
} from "@/lib/contracts/location-profile"
import {
  verificationStateResponseSchema,
  type VerificationStateResponse,
} from "@/lib/contracts/google-verification-state"
import { parseInboxState, toReviewsFilters } from "@/lib/inbox/url-state"
import {
  parsePhotosState,
  toMediaQuery,
} from "@/lib/locations/photos-url-state"
import { DEFAULT_MEDIA_PAGE_SIZE } from "@/lib/media-page"
import { sessionSchema } from "@/lib/contracts/session"
import { pendingAreas, type AreaKey } from "@/lib/listings/pending-areas"
import { queryKeys } from "@/lib/queries/keys"
import { makeQueryClient } from "@/lib/queries/query-client"
import { sessionScopeToken } from "@/lib/queries/session-scope"
import {
  NO_SETTINGS_FEATURES,
  locationCapabilities,
  readSettingsFeatures,
  settingsCapabilities,
  settingsFeaturesApply,
} from "@/lib/server/capabilities"
import { withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { loadBusinessInformation } from "@/lib/server/business-information"
import { getFoodMenusState } from "@/lib/server/food-menus"
import { loadGoogleVerificationState } from "@/lib/server/google-verification-state"
import { listImportProposals } from "@/lib/server/import-review"
import { loadInvitations } from "@/lib/server/invitations/list"
import {
  readHoursResponse,
  readMediaListResponse,
  readPostsListResponse,
} from "@/lib/server/listing-reads"
import { loadLocationAdministration } from "@/lib/server/location-administration"
import { readListingSummaries } from "@/lib/server/location-summary"
import { log } from "@/lib/server/logger"
import { loadMembers } from "@/lib/server/members"
import { readNotificationPreferences as loadNotificationPreferences } from "@/lib/server/notifications/inbox"
import { loadOrgSettings } from "@/lib/server/org-settings"
import { loadPauseSnapshot } from "@/lib/server/pause-controls"
import { loadPlaceActions } from "@/lib/server/place-actions"
import { getProfileState } from "@/lib/server/profile"
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
 *
 * Every payload carries the scope it was read under (`scope`: the session's
 * `sessionScopeToken`). Next can hand an old payload back without running
 * the page again (Back, the router cache), and `<HydrationBoundary>` only
 * hydrates one whose scope is the live session's: a payload read for an
 * admin is never put back into the cache of someone since made a viewer.
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
  /** Resolving to `PREFETCH_SKIP` leaves the key out (nothing new to add). */
  load: () => Promise<unknown>
}

/** What an entry's `load` returns when it has nothing to hydrate. */
export const PREFETCH_SKIP: unique symbol = Symbol("prefetch-skip")

/** A prefetched payload and the scope it was read under (see above). */
export type ScopedDehydratedState = DehydratedState & { scope: string }

/**
 * The scope a payload read for `session` belongs to: the token the browser
 * computes from the same session after `sessionSchema` (the dashboard
 * layout hydrates it that way). A session that doesn't parse gets a scope
 * no live session has, so its payload is never hydrated.
 */
function scopeOf(session: Session | null): string {
  if (!session) return ""
  const parsed = sessionSchema.safeParse(session)
  return parsed.success ? sessionScopeToken(parsed.data) : "unscoped"
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
): Promise<ScopedDehydratedState> {
  const scope = scopeOf(session)
  if (!session) return { ...dehydrate(client), scope }
  const list = typeof entries === "function" ? entries(session) : entries
  const results = await Promise.allSettled(list.map((entry) => entry.load()))
  results.forEach((result, index) => {
    const { queryKey } = list[index]
    if (result.status === "fulfilled") {
      if (result.value !== PREFETCH_SKIP)
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
  return { ...dehydrate(client), scope }
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

/** What `useSettings()` fetches: the `settings` of `GET /api/settings`. */
export async function readOrgSettings(session: Session): Promise<OrgSettings> {
  const payload = {
    settings: await withTenant(session.organisationId, (sql) =>
      loadOrgSettings(sql, session.organisationId)
    ),
  }
  return throughWire(settingsResponseSchema, payload).settings
}

/**
 * What `useMembers()` fetches: `GET /api/members` (owners and admins only).
 */
export async function readMembers(session: Session): Promise<MembersResponse> {
  const payload = await withTenant(session.organisationId, (sql) =>
    loadMembers(sql)
  )
  return throughWire(membersResponseSchema, payload)
}

/**
 * What `useInvitations()` fetches: `GET /api/invitations` (owners and
 * admins only).
 */
export async function readInvitations(
  session: Session
): Promise<InvitationsResponse> {
  const payload = await withTenant(session.organisationId, (sql) =>
    loadInvitations(sql, session.organisationId)
  )
  return throughWire(invitationsResponseSchema, payload)
}

/**
 * What the notification settings read: `GET /api/notifications/preferences`,
 * the signed-in person's own choices.
 */
export async function readNotificationPreferences(
  session: Session
): Promise<NotificationPreferencesResponse> {
  // Rendered for this build's own client, which reads the approval kinds.
  const payload = await loadNotificationPreferences(session, {
    addressedKinds: true,
  })
  return throughWire(notificationPreferencesResponseSchema, payload)
}

/** What `useHours(id)` fetches: `GET /api/locations/{id}/hours`. */
export async function readHours(
  session: Session,
  locationId: string
): Promise<HoursState> {
  const payload = await readHoursResponse(session, locationId)
  return throughWire(hoursResponseSchema, payload).hours
}

/** The photos filters the URL carries, as `useMedia` keys them. */
export type MediaFilters = ReturnType<typeof toMediaQuery>

/**
 * What `useMedia(id, filters)` holds after its first page: the
 * infinite-query shape around what `GET /api/locations/{id}/media` answers.
 * The query takes the browser's path to the route: the parameters
 * `fetchMedia` sends (the photos tab's page size and the URL's filters),
 * parsed by the route's own query schema.
 */
export async function readMediaFirstPage(
  session: Session,
  locationId: string,
  filters: MediaFilters
): Promise<InfiniteData<MediaState, string | null>> {
  const query = mediaListQuerySchema.parse({
    pageSize: String(DEFAULT_MEDIA_PAGE_SIZE),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.ownership ? { ownership: filters.ownership } : {}),
  })
  const payload = await readMediaListResponse(session, locationId, query)
  return {
    pages: [throughWire(mediaListResponseSchema, payload).media],
    pageParams: [null],
  }
}

/**
 * What `usePosts(id)` holds after its first page of the default "all" view
 * (the posts tab's initial filter): `GET /api/locations/{id}/posts` with no
 * query string, exactly the request `fetchPosts` sends for it.
 */
export async function readPostsFirstPage(
  session: Session,
  locationId: string
): Promise<InfiniteData<PostsListResponse, string | null>> {
  const query = postsListQuerySchema.parse({})
  const payload = await readPostsListResponse(session, locationId, query)
  return {
    pages: [throughWire(postsListResponseSchema, payload)],
    pageParams: [null],
  }
}

/** What `useProfile(id)` fetches: `GET /api/locations/{id}/profile`. */
export async function readProfile(
  session: Session,
  locationId: string
): Promise<ProfileState> {
  const payload = {
    profile: await getProfileState(session, locationId),
  } satisfies ProfileResponse
  return throughWire(profileResponseSchema, payload).profile
}

/**
 * What `useBusinessInformation(id)` fetches: `GET
 * /api/locations/{id}/business-information` with no `type`.
 */
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

/** What `useFoodMenus(id)` fetches: `GET /api/locations/{id}/food-menus`. */
export async function readFoodMenus(
  session: Session,
  locationId: string
): Promise<FoodMenusState> {
  const payload = {
    foodMenus: await getFoodMenusState(session, locationId),
  } satisfies FoodMenusResponse
  return throughWire(foodMenusResponseSchema, payload).foodMenus
}

/** What `usePlaceActions(id)` fetches: `GET /api/locations/{id}/place-actions`. */
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

/**
 * What `useImportReview(id, resourceType)` fetches: `GET
 * /api/locations/{id}/import-review?resourceType=…`, open proposals only.
 */
export async function readImportReview(
  session: Session,
  locationId: string,
  resourceType: "profile" | "food_menus"
): Promise<ImportReviewListResponse> {
  const result = await listImportProposals({
    session,
    locationId,
    resourceType,
    includeDecided: false,
  })
  const payload = {
    ...result,
    importReviewEnabled: getServerEnv().IMPORT_REVIEW_ENABLED,
  } satisfies ImportReviewListResponse
  return throughWire(importReviewListResponseSchema, payload)
}

/**
 * What `useAdministration(id)` fetches: `GET
 * /api/locations/{id}/administration` (owners and admins only).
 */
export async function readAdministration(
  session: Session,
  locationId: string
): Promise<AdministrationState> {
  const payload = {
    administration: await loadLocationAdministration(session, locationId),
  } satisfies AdministrationResponse
  return throughWire(administrationResponseSchema, payload).administration
}

/**
 * What `useGoogleVerificationState(id)` fetches: `GET
 * /api/locations/{id}/verification-state` (owners and admins only).
 */
export async function readVerificationState(
  session: Session,
  locationId: string
): Promise<VerificationStateResponse> {
  const payload = (await loadGoogleVerificationState(
    session,
    locationId
  )) satisfies VerificationStateResponse
  return throughWire(verificationStateResponseSchema, payload)
}

// ---------------------------------------------------------------------------
// Page composers
// ---------------------------------------------------------------------------

/**
 * A listing page: its capabilities and its DB-only summary. Both are pure
 * SQL, so the overview's health strip and cards, and an area page's status
 * pill, paint on the first render. The editors' own resources read Google
 * live, so they are never part of this (blocking) prefetch: the hours,
 * photos and posts pages stream theirs behind a Suspense boundary instead
 * (`hoursTabPrefetch`, `photosTabPrefetch`, `postsTabPrefetch`).
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
        queryKey: queryKeys.reviewCountsFor({ clientId }),
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
 * removes that waterfall. Tab state itself is NOT part of this prefetch:
 * hours, profile, photos, booking, menu, business profile, industry and
 * administration read Google live, and posts reconciles against Google on
 * every list (lib/server/posts.ts), so any of them awaited by the page would
 * gate first paint on Google for seconds. The hours, photos and posts pages
 * stream theirs instead (see `hoursTabPrefetch` below).
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

/**
 * /team: the member list and the pending invitations, both pure SQL, so the
 * rows paint in the first HTML instead of a skeleton that then grows (SET-22,
 * the /team layout shift). Only for owners and admins: the only roles the
 * page serves and both routes answer.
 */
export function teamPrefetch(): (session: Session) => PrefetchEntry[] {
  return (session) => {
    if (!managesConsoles(session)) return []
    return [
      { queryKey: queryKeys.members, load: () => readMembers(session) },
      { queryKey: queryKeys.invitations, load: () => readInvitations(session) },
    ]
  }
}

/** /settings/notifications: the signed-in person's own choices. */
export function notificationSettingsPrefetch(): (
  session: Session
) => PrefetchEntry[] {
  return (session) => [
    {
      queryKey: queryKeys.notificationPreferences,
      load: () => readNotificationPreferences(session),
    },
  ]
}

/**
 * Reply policy (/settings on a desk, /settings/policy): the organisation
 * settings PolicyForm edits. Every role reads them (the route has no role
 * gate); only owners and admins can save.
 */
export function replyPolicyPrefetch(): (session: Session) => PrefetchEntry[] {
  return (session) => [
    { queryKey: queryKeys.settings, load: () => readOrgSettings(session) },
  ]
}

// ---------------------------------------------------------------------------
// Streamed editor prefetch (components/listings/streamed-tab.tsx)
// ---------------------------------------------------------------------------
//
// The hours, photos and posts editors' first reads reach Google, so a page
// never awaits them: it renders its shell (header, tabs, the tab's pending
// state) at once and awaits these inside a Suspense boundary that streams
// the editor, with its own <HydrationBoundary>, when the read lands. A read
// that fails is left out (`prefetch` never throws), and the editor fetches
// and shows its error exactly as it did before.
//
// Every route here parses the location id itself and refuses a bad one; the
// prefetch is skipped for anything but a UUID (the listing pages' ids), so
// it never asks a reader for something the client would not have sent.

const locationIdSchema = z.uuid()

function streamable(locationId: string): boolean {
  return locationIdSchema.safeParse(locationId).success
}

/**
 * /listings/{id}/hours: what `useHours(id)` reads on its first render.
 *
 * A live hours read refreshes what the listing summary holds (Google's
 * hours, the reconcile time), which is why `useHours` invalidates the
 * summary after one. The summary is then re-read once the hours read has
 * settled and hydrated after it, so the header's status pill follows the
 * hours read as it did when the browser fetched it. (An existing query
 * hydrates only from newer data, so it never moves the pill backwards.) An
 * hours read served from the stored observation changed nothing, so the
 * page's own summary read (`listingPagePrefetch`) stands and is not
 * repeated.
 */
export function hoursTabPrefetch(
  locationId: string
): (session: Session) => PrefetchEntry[] {
  return (session) => {
    if (!streamable(locationId)) return []
    let hours: Promise<HoursState> | undefined
    const loadHours = () => (hours ??= readHours(session, locationId))
    return [
      { queryKey: queryKeys.locationHours(locationId), load: loadHours },
      {
        queryKey: queryKeys.listingSummary(locationId),
        load: async () => {
          const read = await loadHours().catch(() => undefined)
          if (read?.source === "stored") return PREFETCH_SKIP
          return readListingSummary(session, locationId)
        },
      },
    ]
  }
}

/**
 * /listings/{id}/photos: the first page of `useMedia(id, filters)` for the
 * filters in the request's query string, read with `parsePhotosState` →
 * `toMediaQuery` as the photos tab reads its URL.
 */
export function photosTabPrefetch(
  locationId: string,
  search: URLSearchParams
): (session: Session) => PrefetchEntry[] {
  return (session) => {
    if (!streamable(locationId)) return []
    const filters = toMediaQuery(parsePhotosState(search))
    return [
      {
        queryKey: queryKeys.locationMedia(locationId, filters),
        load: () => readMediaFirstPage(session, locationId, filters),
      },
    ]
  }
}

/** /listings/{id}/posts: the first page of the "all" view `usePosts(id)` opens on. */
export function postsTabPrefetch(
  locationId: string
): (session: Session) => PrefetchEntry[] {
  return (session) => {
    if (!streamable(locationId)) return []
    return [
      {
        queryKey: queryKeys.locationPostsView(locationId, "all"),
        load: () => readPostsFirstPage(session, locationId),
      },
    ]
  }
}

/**
 * The listing summary again, once `read` has settled, for an editor whose
 * live read refreshes what the summary holds (its hook invalidates the
 * summary after one). `skip` says when the read changed nothing, so the
 * layout's own summary read stands.
 */
function summaryAfter<T>(
  session: Session,
  locationId: string,
  read: () => Promise<T>,
  skip: (value: T) => boolean = () => false
): PrefetchEntry {
  return {
    queryKey: queryKeys.listingSummary(locationId),
    load: async () => {
      const value = await read().catch(() => undefined)
      if (value !== undefined && skip(value)) return PREFETCH_SKIP
      return readListingSummary(session, locationId)
    },
  }
}

/** Owners and admins: the only roles the console routes answer. */
function managesConsoles(session: Session): boolean {
  return session.role === "owner" || session.role === "admin"
}

/**
 * /listings/{id}/profile: `useProfile(id)` and the business information
 * the editor reads once the profile lands, read side by side. Both serve
 * the stored observation within the same staleness budget, so the second
 * rarely costs more than the first. Left to the browser, the business half
 * of the editor (labels, categories, attributes) painted seconds after the
 * rest, after hydration, and became the page's largest paint (L16 LCP).
 * A live profile read refreshes the summary, as with hours.
 */
export function profileTabPrefetch(
  locationId: string
): (session: Session) => PrefetchEntry[] {
  return (session) => {
    if (!streamable(locationId)) return []
    let profile: Promise<ProfileState> | undefined
    const loadProfile = () => (profile ??= readProfile(session, locationId))
    return [
      { queryKey: queryKeys.locationProfile(locationId), load: loadProfile },
      {
        queryKey: queryKeys.locationBusinessInformation(locationId),
        load: () => readBusinessInformation(session, locationId),
      },
      summaryAfter(
        session,
        locationId,
        loadProfile,
        (read) => read.source === "stored"
      ),
    ]
  }
}

/**
 * /listings/{id}/menu: `useFoodMenus(id)`. Its hook refreshes the summary
 * after every read, so the summary is read again once the menus settle.
 */
export function menuTabPrefetch(
  locationId: string
): (session: Session) => PrefetchEntry[] {
  return (session) => {
    if (!streamable(locationId)) return []
    let menus: Promise<FoodMenusState> | undefined
    const loadMenus = () => (menus ??= readFoodMenus(session, locationId))
    return [
      { queryKey: queryKeys.locationMenu(locationId), load: loadMenus },
      summaryAfter(session, locationId, loadMenus),
    ]
  }
}

/**
 * /listings/{id}/changes: what Review & publish compares, read only for the
 * areas the DB summary says have saved edits (`pendingAreas`), the ones it
 * builds a review from (`useProfileReview`, `useHoursReview`,
 * `useMenuReview`). An area with nothing waiting is never read from Google
 * here. The summary is read first (pure SQL, shared by the three entries),
 * then each pending area live, side by side. As with the area pages, a live
 * read refreshes the summary, so it is read again once they settle unless
 * every one was served from the stored observation. A summary that can't be
 * read leaves every key to the browser, and counts as no Google read.
 */
export function changesTabPrefetch(
  locationId: string
): (session: Session) => PrefetchEntry[] {
  return (session) => {
    if (!streamable(locationId)) return []
    let summary: Promise<ListingSummary | null> | undefined
    const loadSummary = () =>
      (summary ??= readListingSummary(session, locationId))
    // Per area: undefined when nothing was read (nothing waiting there).
    const reads = new Map<AreaKey, Promise<{ stored: boolean } | undefined>>()
    const areaEntry = <T extends object>(
      area: AreaKey,
      queryKey: QueryKey,
      read: () => Promise<T>
    ): PrefetchEntry => {
      let value: Promise<T | typeof PREFETCH_SKIP> | undefined
      const load = () =>
        (value ??= (async () => {
          const current = await loadSummary().catch(() => null)
          if (!current || !pendingAreas(current).includes(area))
            return PREFETCH_SKIP
          return read()
        })())
      reads.set(
        area,
        load().then(
          (result) =>
            result === PREFETCH_SKIP
              ? undefined
              : { stored: "source" in result && result.source === "stored" },
          // A failed live read still touched Google: the summary is read again.
          () => ({ stored: false })
        )
      )
      return { queryKey, load }
    }
    return [
      areaEntry("profile", queryKeys.locationProfile(locationId), () =>
        readProfile(session, locationId)
      ),
      areaEntry("hours", queryKeys.locationHours(locationId), () =>
        readHours(session, locationId)
      ),
      areaEntry("menu", queryKeys.locationMenu(locationId), () =>
        readFoodMenus(session, locationId)
      ),
      {
        queryKey: queryKeys.listingSummary(locationId),
        load: async () => {
          const results = await Promise.all(reads.values())
          const live = results.filter((read) => read && !read.stored)
          if (live.length === 0) return PREFETCH_SKIP
          return readListingSummary(session, locationId)
        },
      },
    ]
  }
}

/** /listings/{id}/booking: `usePlaceActions(id)`. */
export function bookingTabPrefetch(
  locationId: string
): (session: Session) => PrefetchEntry[] {
  return (session) => {
    if (!streamable(locationId)) return []
    return [
      {
        queryKey: queryKeys.locationBooking(locationId),
        load: () => readPlaceActions(session, locationId),
      },
    ]
  }
}

/** /listings/{id}/people: `useAdministration(id)`, for owners and admins. */
export function peopleTabPrefetch(
  locationId: string
): (session: Session) => PrefetchEntry[] {
  return (session) => {
    if (!streamable(locationId) || !managesConsoles(session)) return []
    return [
      {
        queryKey: queryKeys.locationAdministration(locationId),
        load: () => readAdministration(session, locationId),
      },
    ]
  }
}

/**
 * /listings/{id}/verification: `useGoogleVerificationState(id)`, for owners
 * and admins.
 */
export function verificationTabPrefetch(
  locationId: string
): (session: Session) => PrefetchEntry[] {
  return (session) => {
    if (!streamable(locationId) || !managesConsoles(session)) return []
    return [
      {
        queryKey: queryKeys.locationVerificationState(locationId),
        load: () => readVerificationState(session, locationId),
      },
    ]
  }
}

/**
 * /listings/{id}/suggestions: the profile the page waits on (`useProfile`,
 * shared with the profile editor) and both proposal lists
 * (`useImportReview(id, "profile" | "food_menus")`).
 */
export function suggestionsTabPrefetch(
  locationId: string
): (session: Session) => PrefetchEntry[] {
  return (session) => {
    if (!streamable(locationId)) return []
    let profile: Promise<ProfileState> | undefined
    const loadProfile = () => (profile ??= readProfile(session, locationId))
    return [
      { queryKey: queryKeys.locationProfile(locationId), load: loadProfile },
      ...(["profile", "food_menus"] as const).map((type) => ({
        queryKey: [...queryKeys.locationImportReview(locationId), type],
        load: () => readImportReview(session, locationId, type),
      })),
      summaryAfter(
        session,
        locationId,
        loadProfile,
        (read) => read.source === "stored"
      ),
    ]
  }
}
