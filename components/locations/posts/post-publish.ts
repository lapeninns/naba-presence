import type { LocationCapabilities } from "@/lib/contracts/location-capabilities"
import type { OperationOutcome } from "@/lib/contracts/mutation-operations"
import { successToastFields, type OutcomeMessage } from "@/lib/editors/outcome"
import {
  contentEditDisabledReason,
  resourceDisabledReason,
} from "@/lib/locations/gating"

/**
 * What a post's publish action is, and why it is off. One answer for the
 * list's action and the composer's footer, so both name the same gate.
 *
 * The server routes a non-publisher's publish to `awaiting_approval`
 * (lib/server/posts.ts), so the same mutation asks for approval. Its gate must
 * NOT come from `resourceDisabledReason`: for precisely these users that
 * resolves to `publish_not_allowed`, the gate the approval flow exists to
 * route around. A viewer may neither request approval nor edit, so the action
 * stays visible but off, with the reason.
 */
export function postPublishGate(
  caps: LocationCapabilities | undefined,
  writesEnabled: boolean
): {
  /** Publishing is a request for approval: nothing goes to Google yet. */
  requestApproval: boolean
  /** Why Publish (or Request approval) is off, in words; null when on. */
  reason: string | null
  /** Why the Google publish pause is on, in words; null when writes are on. */
  pausedReason: string | null
} {
  const pausedReason = writesEnabled
    ? null
    : "Publishing to Google is currently unavailable."
  const requestApproval = caps ? !caps.canPublish : false
  const reason = requestApproval
    ? (pausedReason ?? contentEditDisabledReason(caps))
    : (pausedReason ?? resourceDisabledReason(caps, "posts", writesEnabled))
  return { requestApproval, reason, pausedReason }
}

/**
 * The toast for a publish answer. The route's `operation.outcome` says what
 * Google's own state for the post shows (lib/domain/post-outcome.ts): live,
 * still being reviewed, or rejected. Without one the post was only sent.
 */
export function publishOutcome(result: {
  status: string
  operation?: { outcome: OperationOutcome }
}): OutcomeMessage {
  // Waiting for an approver: nothing has gone to Google yet.
  if (result.status === "awaiting_approval")
    return { outcome: "saved_locally", title: "Post submitted for approval." }
  const outcome = result.operation?.outcome
  // A rejected post is on Google and invisible to everyone, so the toast
  // must not say it was published.
  if (result.status === "rejected" || outcome === "rejected")
    return { outcome: "rejected", title: "Google rejected this post." }
  if (outcome === "confirmed_applied")
    return { outcome, title: "Post live on Google" }
  if (outcome === "awaiting_confirmation")
    return {
      outcome,
      title: "Post sent to Google",
      description: "Google is still reviewing it, so it may not show yet.",
    }
  if (outcome === "uncertain") return { outcome }
  // "published" with no outcome: Google took the post and did not reject
  // it; it may still be processing, so this is "sent", not "live".
  return { outcome: "sent", title: "Post sent to Google" }
}

/**
 * The outcome toast for a publish or an approve-and-publish. Whatever went
 * to Google is a Google write: never Undo (D5). The answer carries no
 * Google link, so none is offered. A request for approval sent nothing to
 * Google, so it stays a plain (local) toast.
 */
export function publishToast(result: Parameters<typeof publishOutcome>[0]) {
  const fields = successToastFields(publishOutcome(result))
  return result.status === "awaiting_approval"
    ? fields
    : { ...fields, kind: "google" as const }
}
