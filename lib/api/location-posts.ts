import { z } from "zod"

import type { LocalPostFormValues } from "@/lib/locations/forms/local-post"

import { apiFetch, type RequestOptions } from "./client"

const postSchema = z.object({
  id: z.string(),
  topicType: z.enum(["STANDARD", "EVENT", "OFFER"]),
  languageCode: z.string(),
  summary: z.string(),
  callToAction: z.unknown(),
  event: z.unknown(),
  offer: z.unknown(),
  media: z.unknown(),
  scheduledTime: z.string().nullable(),
  status: z.enum(["draft", "awaiting_approval", "publishing", "published", "failed", "ambiguous"]),
  googlePostName: z.string().nullable(),
  googleState: z.string().nullable(),
  googleSearchUrl: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Post = z.infer<typeof postSchema>

const postsStateSchema = z.object({
  posts: z.array(postSchema),
  writesEnabled: z.boolean(),
  reconciliationError: z.string().nullable(),
})
export type PostsState = z.infer<typeof postsStateSchema>

export function fetchPosts(id: string, options?: RequestOptions): Promise<PostsState> {
  return apiFetch(`/api/locations/${id}/posts`, { schema: postsStateSchema, ...options })
}

export function createPost(id: string, input: LocalPostFormValues) {
  return apiFetch(`/api/locations/${id}/posts`, {
    method: "POST",
    body: input,
    schema: z.object({ post: z.object({ id: z.string() }) }),
  })
}

// The route (app/api/locations/[id]/posts/[postId]/route.ts PATCH) returns
// { post } for a plain draft edit, but when the edited post was already
// "published" it instead republishes to Google and returns the raw
// requestOrPublishLocalPost() outcome — the same shape publishPost() returns
// — with no `post` key at all. Accept both shapes so that case parses.
export type UpdatePostResult =
  | { post: { id: string; status: string } }
  | PublishPostResult

export function updatePost(id: string, postId: string, input: LocalPostFormValues): Promise<UpdatePostResult> {
  return apiFetch(`/api/locations/${id}/posts/${postId}`, {
    method: "PATCH",
    body: input,
    schema: z.union([
      z.object({ post: z.object({ id: z.string(), status: z.string() }) }),
      z.object({
        status: z.enum(["awaiting_approval", "published"]),
        postId: z.string().optional(),
        googlePostName: z.string().nullable().optional(),
      }),
    ]),
  })
}

export type PublishPostResult = { status: "awaiting_approval" | "published"; postId?: string; googlePostName?: string | null }

export function publishPost(id: string, postId: string): Promise<PublishPostResult> {
  return apiFetch(`/api/locations/${id}/posts/${postId}/publish`, {
    method: "POST",
    schema: z.object({ status: z.enum(["awaiting_approval", "published"]), postId: z.string().optional(), googlePostName: z.string().nullable().optional() }),
  })
}

export function decidePostApproval(id: string, postId: string, decision: "approve" | "reject") {
  return apiFetch(`/api/locations/${id}/posts/${postId}/approval`, {
    method: "POST",
    body: { decision },
    schema: z.object({ status: z.string(), postId: z.string().optional(), googlePostName: z.string().nullable().optional() }),
  })
}

export function deletePost(id: string, postId: string) {
  return apiFetch(`/api/locations/${id}/posts/${postId}`, {
    method: "DELETE",
    schema: z.object({ status: z.string() }),
  })
}
