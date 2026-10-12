/**
 * Media create reconciliation (plan P03-S5): which live Google media item, if
 * any, an uncertain create made.
 *
 * Google names a new media item only in the create response, so when that
 * response is lost the item can only be recognised by what it holds. A
 * candidate must carry the requested format, category and description (and
 * source URL, for a create from a URL), must have been created no earlier
 * than the attempt started (less a clock-skew allowance), and must not be an
 * item another create already claimed. Exactly one candidate is adopted;
 * none or several leave the create for a person to resolve, because adopting
 * the wrong photo would hide a duplicate and re-creating could make one.
 *
 * Nothing in an upload's item ties it to its bytes, so a candidate can also
 * be another create's photo: one with the same format and category whose
 * outcome is still open, or that a person adopted without its name. While
 * such a create overlaps the attempt (`contested`), no candidate is adopted.
 * An item someone adds in Google directly in the same window cannot be told
 * apart; the photos tab shows what was adopted.
 *
 * Pure: lib/server/media.ts lists the media and records the verdict.
 */

/** Google's `createTime` may run behind the server clock by this much. */
export const MEDIA_CREATE_TIME_SKEW_MS = 2 * 60 * 1000

/** The upload checkpoints on gbp_media_mutation (0093), in order. */
export const MEDIA_UPLOAD_PHASES = [
  "none",
  "data_ref_obtained",
  "bytes_uploaded",
  "create_sent",
] as const
export type MediaUploadPhase = (typeof MEDIA_UPLOAD_PHASES)[number]

/** What the create asked Google for. */
export type MediaCreateIntent = {
  mediaFormat: string
  category: string
  description?: string | null
  /** Set for a create from a URL; an upload has none. */
  sourceUrl?: string | null
}

export type MediaCreateMatch =
  | { kind: "match"; item: Record<string, unknown> }
  | { kind: "none" }
  | { kind: "several"; count: number }
  /** Candidates exist, but another open create could account for them. */
  | { kind: "contested"; count: number }

function categoryOf(item: Record<string, unknown>): string | null {
  const association = item.locationAssociation
  if (!association || typeof association !== "object") return null
  const category = (association as { category?: unknown }).category
  return typeof category === "string" ? category : null
}

/** Google trims descriptions and omits an empty one. */
function sameText(left: unknown, right: unknown): boolean {
  const text = (value: unknown) =>
    typeof value === "string" ? value.trim() : ""
  return text(left) === text(right)
}

/** Whether `item` holds exactly what `intent` asked for. */
export function mediaItemMatchesIntent(
  item: Record<string, unknown>,
  intent: MediaCreateIntent
): boolean {
  if (item.mediaFormat !== intent.mediaFormat) return false
  if (categoryOf(item) !== intent.category) return false
  if (!sameText(item.description, intent.description)) return false
  if (intent.sourceUrl && item.sourceUrl !== intent.sourceUrl) return false
  return true
}

export function matchCreatedMedia(
  items: readonly Record<string, unknown>[],
  intent: MediaCreateIntent,
  options: {
    /** When the attempt started; Google cannot have created it before. */
    startedAt: Date
    /** Items other creates already claimed. */
    claimedNames?: ReadonlySet<string>
    /**
     * Another create of the same format and category overlaps the attempt
     * and has no item name of its own (still open, or adopted by a person).
     */
    contested?: boolean
  }
): MediaCreateMatch {
  const notBefore = options.startedAt.getTime() - MEDIA_CREATE_TIME_SKEW_MS
  const candidates = items.filter((item) => {
    if (typeof item.name !== "string") return false
    if (options.claimedNames?.has(item.name)) return false
    const created =
      typeof item.createTime === "string" ? Date.parse(item.createTime) : NaN
    // An item with no readable createTime cannot be placed after the attempt.
    if (!Number.isFinite(created) || created < notBefore) return false
    return mediaItemMatchesIntent(item, intent)
  })
  if (candidates.length === 0) return { kind: "none" }
  if (options.contested) {
    return { kind: "contested", count: candidates.length }
  }
  if (candidates.length === 1) return { kind: "match", item: candidates[0] }
  return { kind: "several", count: candidates.length }
}
