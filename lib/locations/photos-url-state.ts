/**
 * Photos tab URL state (Sprint 4.2c). The ownership and category filters
 * live in the query string so a filtered view survives reload, back/forward
 * and sharing — the same model as lib/inbox/url-state.ts. Defaults are
 * omitted when serialising, so the plain `/photos` URL stays canonical.
 *
 * Param names match the media API's own query (`ownership`, `category`) so
 * the URL reads the same as the request it produces. The library pages by
 * cursor ("Load more"), so there is no page in the URL; a `page` left over
 * in an old link is ignored and dropped on the next change.
 */
import {
  MEDIA_OWNERSHIPS,
  type MediaOwnership,
} from "@/lib/contracts/location-media"
import {
  GOOGLE_MEDIA_CATEGORIES,
  type GoogleMediaCategory,
} from "@/lib/domain/google-contract"

export type OwnershipFilter = "all" | MediaOwnership
export type CategoryFilter = "all" | GoogleMediaCategory

export type PhotosState = {
  ownership: OwnershipFilter
  category: CategoryFilter
}

export const DEFAULT_PHOTOS_STATE: PhotosState = {
  ownership: "all",
  category: "all",
}

export const OWNERSHIP_FILTERS: ReadonlyArray<{
  value: OwnershipFilter
  label: string
}> = [
  { value: "all", label: "All" },
  { value: "merchant", label: "Your photos" },
  { value: "customer", label: "Customer photos" },
]

function isOwnership(value: string): value is MediaOwnership {
  return (MEDIA_OWNERSHIPS as readonly string[]).includes(value)
}

function isCategory(value: string): value is GoogleMediaCategory {
  return (GOOGLE_MEDIA_CATEGORIES as readonly string[]).includes(value)
}

/** Unknown or malformed values fall back to the default, never throw. */
export function parsePhotosState(params: URLSearchParams): PhotosState {
  const rawOwnership = params.get("ownership") ?? ""
  const rawCategory = params.get("category") ?? ""
  return {
    ownership: isOwnership(rawOwnership) ? rawOwnership : "all",
    category: isCategory(rawCategory) ? rawCategory : "all",
  }
}

/**
 * Write the state onto `current` (unrelated params are preserved), omitting
 * every default so `/photos` is the canonical form of the default view.
 */
export function serializePhotosState(
  state: PhotosState,
  current: URLSearchParams = new URLSearchParams()
): URLSearchParams {
  const params = new URLSearchParams(current)
  params.delete("page")
  params.delete("ownership")
  params.delete("category")
  if (state.ownership !== "all") params.set("ownership", state.ownership)
  if (state.category !== "all") params.set("category", state.category)
  return params
}

/** Whether either browse filter narrows the library (drives the empty-state copy). */
export function hasActivePhotoFilters(state: PhotosState): boolean {
  return state.ownership !== "all" || state.category !== "all"
}

/** URL state -> the `useMedia` / `fetchMedia` parameters (`null` = no filter). */
export function toMediaQuery(state: PhotosState): {
  category: GoogleMediaCategory | null
  ownership: MediaOwnership | null
} {
  return {
    category: state.category === "all" ? null : state.category,
    ownership: state.ownership === "all" ? null : state.ownership,
  }
}
