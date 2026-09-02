import "server-only"

/**
 * The provider phase: every Google reply call the pipeline makes, always
 * OUTSIDE a database transaction. Each call returns `{ response }` or
 * `{ error }` so the caller can settle in a fresh tenant transaction; only
 * `readGoogleReview` (recovery's readback) throws, and it throws
 * `GoogleMutationAmbiguousError` for any failure because a readback that
 * fails leaves the provider state unknown.
 */

import { decryptSecret } from "@/lib/server/crypto"
import { getDatabase } from "@/lib/server/db"
import {
  connectionAccessToken,
  deleteGoogleReply,
  getGoogleReview,
  GoogleMutationAmbiguousError,
  updateGoogleReply,
} from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"

/** The `reviewReply` sub-resource of a Google review (also the reply PUT response). */
export type GoogleReviewReply = {
  comment?: string
  state?: string
  policyViolation?: unknown
  updateTime?: string
}

/** The Google review resource as far as the reply pipeline reads it. */
export type GoogleReviewResource = {
  reviewReply?: GoogleReviewReply | null
  reviewReplyState?: string
}

/** Narrow a raw Google reply payload to the fields the pipeline reads. */
export function parseGoogleReply(
  raw: unknown
): GoogleReviewReply | null {
  if (!raw || typeof raw !== "object") return null
  const record = raw as Record<string, unknown>
  return {
    comment: typeof record.comment === "string" ? record.comment : undefined,
    state: typeof record.state === "string" ? record.state : undefined,
    policyViolation: record.policyViolation,
    updateTime: typeof record.updateTime === "string" ? record.updateTime : undefined,
  }
}

/** Narrow a raw Google review payload to the fields the pipeline reads. */
export function parseGoogleReview(
  raw: Record<string, unknown>
): GoogleReviewResource {
  return {
    reviewReply: parseGoogleReply(raw.reviewReply),
    reviewReplyState:
      typeof raw.reviewReplyState === "string"
        ? raw.reviewReplyState
        : undefined,
  }
}

export function googleReplyFromReview(
  review: GoogleReviewResource
): GoogleReviewReply | null {
  return review.reviewReply ?? null
}

export function googleReplyMatches(
  review: GoogleReviewResource,
  expectedBody: string
) {
  const reply = googleReplyFromReview(review)
  return typeof reply?.comment === "string" && reply.comment === expectedBody
}

/** A Google reply target: the connection to authenticate with and the review name. */
export type ReplyTarget = {
  organisationId: string
  connectionId: string
  /** Decrypted `reviews/...` resource name. */
  googleReviewName: string
}

export function replyTarget(input: {
  organisationId: string
  connectionId: string
  googleReviewNameCiphertext: Buffer
}): ReplyTarget {
  return {
    organisationId: input.organisationId,
    connectionId: input.connectionId,
    googleReviewName: decryptSecret(input.googleReviewNameCiphertext),
  }
}

export type ProviderCall<T> =
  { response: T; error?: undefined } | { response?: undefined; error: unknown }

async function accessTokenFor(target: ReplyTarget) {
  return connectionAccessToken(
    getDatabase(),
    target.organisationId,
    target.connectionId
  )
}

/**
 * PUT the reply body to Google. An empty 200 body (`googleRequest` returns
 * null) is reported as `{ error: undefined }`: the pipeline has always
 * settled that as a generic `network_error` failure rather than a success.
 */
export async function publishReplyToGoogle(
  target: ReplyTarget,
  body: string
): Promise<ProviderCall<GoogleReviewReply>> {
  try {
    const accessToken = await accessTokenFor(target)
    const raw = await updateGoogleReply(
      accessToken,
      target.googleReviewName,
      body,
      { connectionKey: target.connectionId }
    )
    if (!raw) return { error: undefined }
    return { response: parseGoogleReply(raw) ?? {} }
  } catch (error) {
    return { error }
  }
}

/**
 * DELETE the reply at Google. When `treatNotFoundAsApplied` is set a 404
 * counts as applied (the reply is already gone), which is the interactive
 * delete's behaviour; the job-runner retry keeps a 404 as a failure.
 */
export async function deleteReplyFromGoogle(
  target: ReplyTarget,
  options: { treatNotFoundAsApplied?: boolean } = {}
): Promise<ProviderCall<Record<string, never>>> {
  try {
    const accessToken = await accessTokenFor(target)
    await deleteGoogleReply(accessToken, target.googleReviewName, {
      connectionKey: target.connectionId,
    })
    return { response: {} }
  } catch (error) {
    if (
      options.treatNotFoundAsApplied &&
      error instanceof ApiError &&
      error.status === 404
    ) {
      return { response: {} }
    }
    return { error }
  }
}

/**
 * Recovery readback: fetch the live review once. Any failure is surfaced as
 * `GoogleMutationAmbiguousError` because the provider state stays unknown.
 */
export async function readGoogleReview(
  target: ReplyTarget
): Promise<GoogleReviewResource> {
  try {
    const accessToken = await accessTokenFor(target)
    const raw = await getGoogleReview(accessToken, target.googleReviewName, {
      connectionKey: target.connectionId,
      maxAttempts: 1,
    })
    if (!raw || typeof raw !== "object") {
      throw new GoogleMutationAmbiguousError(
        "Google returned no review resource."
      )
    }
    return parseGoogleReview(raw)
  } catch (error) {
    if (error instanceof GoogleMutationAmbiguousError) throw error
    throw new GoogleMutationAmbiguousError(
      error instanceof Error ? error.message : undefined
    )
  }
}
