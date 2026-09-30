import { z } from "zod"
import { apiFetch, ApiClientError, type RequestOptions } from "./client"
import {
  googleOnboardingDraftSchema,
  googleOnboardingDraftListSchema,
  googleOnboardingCreationSchema,
  googleOnboardingReviewSchema,
  type googleOnboardingReviewInputSchema,
  type googleOnboardingDraftCreateSchema,
  type googleOnboardingDraftSaveSchema,
} from "@/lib/contracts/google-onboarding"

const draftPath = (accountId: string, draftId?: string) =>
  `/api/google/accounts/${encodeURIComponent(accountId)}/drafts${draftId ? `/${encodeURIComponent(draftId)}` : ""}`

export function fetchOnboardingDrafts(
  accountId: string,
  connectionId: string,
  clientId: string,
  options?: RequestOptions
) {
  return apiFetch(
    `${draftPath(accountId)}?${new URLSearchParams({ connectionId, clientId })}`,
    { schema: googleOnboardingDraftListSchema, ...options }
  )
}
export function fetchOnboardingDraft(
  accountId: string,
  draftId: string,
  options?: RequestOptions
) {
  return apiFetch(draftPath(accountId, draftId), {
    schema: googleOnboardingDraftSchema,
    ...options,
  })
}
export function createOnboardingDraft(
  accountId: string,
  input: z.infer<typeof googleOnboardingDraftCreateSchema>
) {
  return apiFetch(draftPath(accountId), {
    method: "POST",
    body: input,
    schema: googleOnboardingDraftSchema,
  })
}
export function saveOnboardingDraft(
  accountId: string,
  draftId: string,
  input: z.infer<typeof googleOnboardingDraftSaveSchema>
) {
  return apiFetch(draftPath(accountId, draftId), {
    method: "PUT",
    body: input,
    schema: googleOnboardingDraftSchema,
  })
}
export function matchOnboardingDraft(
  accountId: string,
  draftId: string,
  expectedRevision: number
) {
  return apiFetch(`${draftPath(accountId, draftId)}/matches`, {
    method: "POST",
    body: { expectedRevision },
    schema: googleOnboardingDraftSchema,
  })
}
export async function fetchOnboardingCreation(
  accountId: string,
  draftId: string,
  options?: RequestOptions
) {
  try {
    return await apiFetch(`${draftPath(accountId, draftId)}/creation`, {
      schema: googleOnboardingCreationSchema,
      ...options,
    })
  } catch (error) {
    if (
      error instanceof ApiClientError &&
      error.code === "onboarding_creation_not_found"
    )
      return null
    throw error
  }
}
export function linkOnboardingCreation(
  accountId: string,
  draftId: string,
  localName: string
) {
  return apiFetch(`${draftPath(accountId, draftId)}/creation/link`, {
    method: "POST",
    body: { localName },
    schema: googleOnboardingCreationSchema,
  })
}

export function createOnboardingReview(
  accountId: string,
  draftId: string,
  input: z.infer<typeof googleOnboardingReviewInputSchema>
) {
  return apiFetch(`${draftPath(accountId, draftId)}/reviews`, {
    method: "POST",
    body: input,
    schema: googleOnboardingReviewSchema,
  })
}
export function fetchOnboardingReview(
  accountId: string,
  draftId: string,
  reviewId: string,
  options?: RequestOptions
) {
  return apiFetch(
    `${draftPath(accountId, draftId)}/reviews/${encodeURIComponent(reviewId)}`,
    { schema: googleOnboardingReviewSchema, ...options }
  )
}
export function approveOnboardingReview(
  accountId: string,
  draftId: string,
  reviewId: string,
  expectedReviewHash: string
) {
  return apiFetch(
    `${draftPath(accountId, draftId)}/reviews/${encodeURIComponent(reviewId)}`,
    {
      method: "POST",
      body: { expectedReviewHash },
      schema: googleOnboardingReviewSchema,
    }
  )
}
export function submitOnboardingCreation(
  accountId: string,
  draftId: string,
  reviewId: string,
  expectedReviewHash: string
) {
  return apiFetch(`${draftPath(accountId, draftId)}/creation`, {
    method: "POST",
    body: { reviewId, expectedReviewHash },
    schema: googleOnboardingCreationSchema,
  })
}
