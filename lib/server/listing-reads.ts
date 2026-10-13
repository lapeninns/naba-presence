import "server-only"

import type { HoursResponse } from "@/lib/contracts/location-hours"
import type {
  MediaListQuery,
  MediaListResponseWire,
} from "@/lib/contracts/location-media"
import type { PostsListQuery } from "@/lib/contracts/location-posts"
import { getHoursState } from "@/lib/server/hours"
import { loadMedia } from "@/lib/server/media"
import { listLocalPosts } from "@/lib/server/posts"
import type { Session } from "@/lib/server/session"

/**
 * The listing editors' first reads: THE ONLY implementations of the bodies
 * `GET /api/locations/{id}/hours`, `…/media` and `…/posts` answer.
 *
 * The routes call these, and so does the hours, photos and posts pages'
 * streamed server prefetch (lib/server/prefetch.ts), so what paints in the
 * first HTML is produced exactly as a later client fetch produces it: the
 * same location access checks, Google reads, reconciliation and write
 * switches (`writesEnabled`). Each returns the route's raw body; the
 * prefetch pushes it through the JSON round trip and contract schema the
 * browser applies.
 */

/** `GET /api/locations/{id}/hours`. */
export async function readHoursResponse(
  session: Session,
  locationId: string
): Promise<HoursResponse> {
  return {
    hours: await getHoursState(session, locationId),
  } satisfies HoursResponse
}

/** `GET /api/locations/{id}/media` for a parsed `mediaListQuerySchema`. */
export async function readMediaListResponse(
  session: Session,
  locationId: string,
  query: MediaListQuery
) {
  return {
    media: await loadMedia(session.organisationId, session, locationId, {
      cursor: query.cursor,
      pageSize: query.pageSize ?? 12,
      refresh: query.refresh === "1",
      category: query.category,
      ownership: query.ownership,
    }),
  } satisfies MediaListResponseWire
}

/** `GET /api/locations/{id}/posts` for a parsed `postsListQuerySchema`. */
export function readPostsListResponse(
  session: Session,
  locationId: string,
  query: PostsListQuery
) {
  return listLocalPosts(session.organisationId, session, locationId, query)
}
