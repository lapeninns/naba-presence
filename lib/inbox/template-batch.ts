import type { ReviewRow } from "@/lib/contracts/reviews"

/**
 * Replying to a selection of rating-only reviews from the standard template.
 *
 * Nothing here is a new way to publish. Each review goes through the same two
 * endpoints a single reply does — the draft route (which picks the rating
 * template itself for a review with no text, and verifies the result) and the
 * publish route (which parks the reply for approval when the operator may not
 * publish). The batch only decides which rows to send and runs them a few at
 * a time, so every permission, workflow and verification rule still applies
 * per review.
 */

/** Why a selected row is left out of a template batch. */
export type TemplateSkipReason =
  | "has_text"
  | "low_rating"
  | "has_draft"
  | "has_reply"
  | "busy"
  | "no_permission"

export const TEMPLATE_SKIP_COPY: Record<TemplateSkipReason, string> = {
  has_text: "wrote a review, so it needs a personal reply",
  low_rating: "1 or 2 stars, left for a personal reply",
  has_draft: "already has a draft; open it to check and publish",
  has_reply: "already has a reply on Google",
  busy: "a publish or approval is already under way",
  no_permission: "you can't reply to this venue",
}

// Only an untouched review starts a template draft. Every later state has a
// draft, an approval, a publish or a failure someone should see, and the
// batch must not replace any of those unseen.
const DRAFTABLE = new Set(["new"])

export function isRatingOnly(row: Pick<ReviewRow, "text">): boolean {
  return !row.text?.trim()
}

export function templateSkipReason(
  row: ReviewRow,
  options: { includeLowRatings: boolean }
): TemplateSkipReason | null {
  if (!isRatingOnly(row)) return "has_text"
  if (!row.capabilities.canEdit) return "no_permission"
  if (row.replyBody) return "has_reply"
  if (row.draftId) return "has_draft"
  if (!DRAFTABLE.has(row.workflowStatus)) return "busy"
  if (!options.includeLowRatings && row.rating !== null && row.rating <= 2)
    return "low_rating"
  return null
}

export function partitionForTemplate(
  rows: ReviewRow[],
  options: { includeLowRatings: boolean }
): {
  eligible: ReviewRow[]
  skipped: { row: ReviewRow; reason: TemplateSkipReason }[]
} {
  const eligible: ReviewRow[] = []
  const skipped: { row: ReviewRow; reason: TemplateSkipReason }[] = []
  for (const row of rows) {
    const reason = templateSkipReason(row, options)
    if (reason) skipped.push({ row, reason })
    else eligible.push(row)
  }
  return { eligible, skipped }
}

/** The template's three bands, as `ratingOnlyReply` chooses them. */
export type TemplateBand = "positive" | "neutral" | "negative"

export function templateBand(rating: number | null): TemplateBand {
  if (rating === null || rating === 3) return "neutral"
  return rating >= 4 ? "positive" : "negative"
}

/**
 * Runs `work` over `items` with at most `concurrency` in flight, in order of
 * start. `shouldStop` is checked before each start, so Stop lets the calls
 * already in flight finish (a half-sent publish is worse than a finished one)
 * and starts nothing new. A worker that throws records its own outcome; the
 * runner never rejects.
 */
export async function runPool<T>(
  items: readonly T[],
  work: (item: T) => Promise<void>,
  options: { concurrency: number; shouldStop: () => boolean }
): Promise<void> {
  let next = 0
  const lane = async () => {
    while (next < items.length && !options.shouldStop()) {
      const item = items[next++]
      try {
        await work(item)
      } catch {
        // The worker reports its own failure.
      }
    }
  }
  const lanes = Math.max(1, Math.min(options.concurrency, items.length))
  await Promise.all(Array.from({ length: lanes }, lane))
}

/**
 * An error that stops the whole batch rather than one row: the feature is
 * paused, the session ended, or the service is failing. Per-row refusals
 * (a review changed, a verification failed) do not.
 */
export function stopsBatch(error: { status: number; code: string }): boolean {
  return (
    error.status === 401 ||
    error.status >= 500 ||
    error.code === "publishing_paused" ||
    error.code === "drafts_paused"
  )
}
