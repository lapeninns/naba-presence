/**
 * Wire constants the browser shell needs on every page: the API client's
 * request header and the error codes it reacts to. They live apart from
 * their contracts because those modules declare zod schemas at load time,
 * and importing one constant from them puts zod in every page's first-load
 * JavaScript. The contracts re-export them, so either import works.
 *
 * Client-safe and dependency-free: keep it that way.
 */

/** 403 codes a sensitive action answers when two-step verification is due. */
export const MFA_STEP_UP_REQUIRED = "mfa_step_up_required"
export const MFA_ENROLLMENT_REQUIRED = "mfa_enrollment_required"

/**
 * The error code the API client raises for a 202 that parked a write
 * (lib/api/client.ts), so every editor's error path can tell "sent for
 * approval" from a failure.
 */
export const LISTING_CHANGE_AWAITING_APPROVAL =
  "listing_change_awaiting_approval"

/**
 * The request header that carries a client-minted intent id: one UUID per
 * thing a person asked for, resent unchanged when the client retries after a
 * lost answer. It is the stable operation identity; `x-request-id` stays a
 * per-request correlation id. lib/api/client.ts sends it on every mutation and
 * lib/server/route.ts parses it (400 `invalid_intent_id` when it is not a
 * UUID).
 */
export const INTENT_HEADER = "Idempotency-Key"
