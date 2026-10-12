import "server-only"

import { sha256 } from "@/lib/server/crypto"

/**
 * What a publish of a `gbp_local_post` row sends to Google, and the hash an
 * approval binds to (0081 `post_approval_decision.content_hash`). Shared by
 * the post pipeline and scheduling, which freezes the hash of its source
 * draft (P08-R4), without either importing the other.
 */

/** The gbp_local_post columns a publish sends. */
export type PostContent = {
  topicType: "STANDARD" | "EVENT" | "OFFER"
  languageCode: string
  summary: string
  callToAction: Record<string, unknown> | null
  event: Record<string, unknown> | null
  offer: Record<string, unknown> | null
  media: Array<Record<string, unknown>>
}

/**
 * The event as Google accepts it. A post read back from Google carries the
 * output-only `recurringInstanceTime` of its latest repeat; sending that
 * back on an edit is not ours to set.
 */
function providerEvent(event: PostContent["event"]) {
  if (!event) return event
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { recurringInstanceTime, ...writable } = event
  return writable
}

export function providerPayload(post: PostContent) {
  return Object.fromEntries(
    Object.entries({
      languageCode: post.languageCode,
      summary: post.summary,
      callToAction: post.callToAction,
      event: providerEvent(post.event),
      offer: post.offer,
      media: post.media.length ? post.media : undefined,
      topicType: post.topicType,
    }).filter(([, value]) => value !== null && value !== undefined)
  )
}

/** SHA-256 of what a publish of this row would send to Google. */
export function postContentHash(post: PostContent): string {
  return sha256(JSON.stringify(providerPayload(post)))
}
