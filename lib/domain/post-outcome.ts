import type { OperationOutcome } from "@/lib/contracts/mutation-operations"

/**
 * What a Google local post's own state says about a publish, in the shared
 * outcome vocabulary (lib/contracts/mutation-operations.ts). Client-safe: the
 * server settles post receipts with it (lib/server/posts.ts) and the posts
 * tab words its status pills with it (lib/locations/post-display.ts), so the
 * two cannot disagree about when a post is live.
 *
 *   LIVE        confirmed_applied     Google shows the post.
 *   REJECTED    rejected              Google holds it and refused to show it.
 *   PROCESSING  awaiting_confirmation Google is still reviewing it.
 *   anything else (unspecified, not reported yet) awaiting_confirmation:
 *               Google took the post, nothing yet says customers see it.
 */
export function googlePostStateOutcome(
  googleState: string | null | undefined
): Extract<
  OperationOutcome,
  "confirmed_applied" | "awaiting_confirmation" | "rejected"
> {
  if (googleState === "LIVE") return "confirmed_applied"
  if (googleState === "REJECTED") return "rejected"
  return "awaiting_confirmation"
}

/**
 * A stored post's outcome from its row (`gbp_local_post.status` and
 * `google_state`), or null for a post nothing has been sent for yet (a
 * draft, or one waiting for approval).
 */
export function localPostOutcome(post: {
  status: string
  googleState: string | null
  lastErrorCode?: string | null
}): OperationOutcome | null {
  switch (post.status) {
    case "publishing":
      return "sent"
    case "ambiguous":
      return "uncertain"
    case "failed":
      // A post Google holds but refused is settled `failed` with its state
      // kept and `google_post_rejected` as its code, so those, not the
      // status, say it was Google's verdict. A later failed publish keeps the
      // old state but records its own code, and is a plain failure.
      return post.googleState === "REJECTED" &&
        (post.lastErrorCode ?? "google_post_rejected") ===
          "google_post_rejected"
        ? "rejected"
        : "failed"
    case "published":
      return googlePostStateOutcome(post.googleState)
    default:
      return null
  }
}
