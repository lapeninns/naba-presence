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
  type PostsListResponse,
  type PostUpdateResponse,
} from "@/lib/contracts/location-posts"

import { apiFetch, type RequestOptions } from "./client"

export type Post = PostRow
export type PostsState = PostsListResponse
export type PublishPostResult = PostPublishOutcome
// PATCH returns { post } for a plain draft edit, but when the edited post was
// already "published" it republishes to Google and returns the publish
// outcome instead (see postUpdateResponseSchema).
export type UpdatePostResult = PostUpdateResponse

export function fetchPosts(id: string, options?: RequestOptions): Promise<PostsState> {
  return apiFetch(`/api/locations/${id}/posts`, { schema: postsListResponseSchema, ...options })
}

export function createPost(id: string, input: LocalPostInputValues) {
  return apiFetch(`/api/locations/${id}/posts`, {
    method: "POST",
    body: input,
    schema: postCreateResponseSchema,
  })
}

export function updatePost(id: string, postId: string, input: LocalPostInputValues): Promise<UpdatePostResult> {
  return apiFetch(`/api/locations/${id}/posts/${postId}`, {
    method: "PATCH",
    body: input,
    schema: postUpdateResponseSchema,
  })
}

export function publishPost(id: string, postId: string): Promise<PublishPostResult> {
  return apiFetch(`/api/locations/${id}/posts/${postId}/publish`, {
    method: "POST",
    schema: postPublishOutcomeSchema,
  })
}

export function decidePostApproval(
  id: string,
  postId: string,
  decision: PostApprovalDecision["decision"]
): Promise<PostApprovalOutcome> {
  return apiFetch(`/api/locations/${id}/posts/${postId}/approval`, {
    method: "POST",
    body: { decision } satisfies PostApprovalDecision,
    schema: postApprovalOutcomeSchema,
  })
}

export function deletePost(id: string, postId: string) {
  return apiFetch(`/api/locations/${id}/posts/${postId}`, {
    method: "DELETE",
    schema: postDeleteOutcomeSchema,
  })
}
