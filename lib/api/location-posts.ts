import {
  postApprovalOutcomeSchema,
  postCreateResponseSchema,
  postDeleteOutcomeSchema,
  postPublishOutcomeSchema,
  postsListResponseSchema,
  postUpdateResponseSchema,
  type LocalPostInputValues,
  type PostApprovalDecision,
  type PostApprovalOutcome,
  type PostPublishOutcome,
  type PostRow,
  type PostsListQuery,
  type PostsListResponse,
  type PostUpdateResponse,
} from "@/lib/contracts/location-posts"

import { apiFetch, type MutationOptions, type RequestOptions } from "./client"

export type Post = PostRow
export type PostsState = PostsListResponse
export type PublishPostResult = PostPublishOutcome
// PATCH returns { post } for a plain draft edit, but when the edited post was
// already "published" it republishes to Google and returns the publish
// outcome instead (see postUpdateResponseSchema).
export type UpdatePostResult = PostUpdateResponse

/** One page of one status view (or, with `post`, that one post). */
export function fetchPosts(
  id: string,
  params: PostsListQuery = {},
  options?: RequestOptions
): Promise<PostsState> {
  const query = new URLSearchParams()
  if (params.filter && params.filter !== "all") query.set("filter", params.filter)
  if (params.pageSize) query.set("pageSize", String(params.pageSize))
  if (params.cursor) query.set("cursor", params.cursor)
  if (params.post) query.set("post", params.post)
  const suffix = query.size ? `?${query}` : ""
  return apiFetch(`/api/locations/${id}/posts${suffix}`, { schema: postsListResponseSchema, ...options })
}

export function createPost(id: string, input: LocalPostInputValues) {
  return apiFetch(`/api/locations/${id}/posts`, {
    method: "POST",
    body: input,
    schema: postCreateResponseSchema,
  })
}

export function updatePost(id: string, postId: string, input: LocalPostInputValues, expectedUpdatedAt?: string): Promise<UpdatePostResult> {
  return apiFetch(`/api/locations/${id}/posts/${postId}`, {
    method: "PATCH",
    body: expectedUpdatedAt ? { ...input, expectedUpdatedAt } : input,
    schema: postUpdateResponseSchema,
  })
}

export function publishPost(
  id: string,
  postId: string,
  options: MutationOptions = {}
): Promise<PublishPostResult> {
  return apiFetch(`/api/locations/${id}/posts/${postId}/publish`, {
    method: "POST",
    schema: postPublishOutcomeSchema,
    intentId: options.intentId,
  })
}

export function decidePostApproval(
  id: string,
  postId: string,
  decision: PostApprovalDecision["decision"],
  /** The post's `contentRevision` as the approver saw it. */
  expectedRevision: number | undefined
): Promise<PostApprovalOutcome> {
  return apiFetch(`/api/locations/${id}/posts/${postId}/approval`, {
    method: "POST",
    body: { decision, expectedRevision } satisfies PostApprovalDecision,
    schema: postApprovalOutcomeSchema,
  })
}

export function deletePost(id: string, postId: string) {
  return apiFetch(`/api/locations/${id}/posts/${postId}`, {
    method: "DELETE",
    schema: postDeleteOutcomeSchema,
  })
}
