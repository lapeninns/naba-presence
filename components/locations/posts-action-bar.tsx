"use client"

import { useState } from "react"

import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  decidePostApproval,
  deletePost,
  fetchPosts,
  publishPost,
  type Post,
  type PostsState,
} from "@/lib/api/location-posts"
import type { LocationCapabilities } from "@/lib/contracts/location-capabilities"
import { resourceDisabledReason } from "@/lib/locations/gating"
import { queryKeys } from "@/lib/queries/keys"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"

function publishOutcomeTitle(status: string) {
  if (status === "awaiting_approval") return "Post submitted for approval."
  // A rejected post is on Google and invisible to everyone, so the success
  // toast must not say it was published.
  if (status === "rejected") return "Google rejected this post."
  return "Post published to Google"
}

// What the Check Google round-trip found. `reconciliationError` is the only
// honest answer when Google could not be reached: the post's state is exactly
// as unknown as it was before the check.
function checkOutcomeTitle(state: PostsState, postId: string) {
  if (state.reconciliationError)
    return "We couldn’t reach Google just now. Try again shortly."
  const checked = state.posts.find((row) => row.id === postId)
  if (checked?.status === "published") return "This post is live on Google."
  if (checked?.status === "failed")
    return "Google doesn’t have this post, so you can publish it again."
  return "Google’s copy of this post is still unclear."
}

export function PostsActionBar({
  locationId,
  post,
  caps,
  writesEnabled,
}: {
  locationId: string
  post: Post
  caps: LocationCapabilities | undefined
  writesEnabled: boolean
}) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const invalidate = [queryKeys.locationPosts(locationId)]

  const publish = useResourceMutation({
    mutationFn: () => publishPost(locationId, post.id),
    invalidate,
    successToast: (result) => publishOutcomeTitle(result.status),
    errorContext: "post",
  })
  const decide = useResourceMutation({
    mutationFn: (decision: "approve" | "reject") =>
      decidePostApproval(locationId, post.id, decision),
    invalidate,
    successToast: (result, decision) =>
      decision === "reject"
        ? "Sent back to draft"
        : publishOutcomeTitle(result.status),
    errorContext: "post",
  })
  const remove = useResourceMutation({
    mutationFn: () => deletePost(locationId, post.id),
    invalidate,
    successToast: "Post deleted",
    errorContext: "post",
    onSuccess: () => setDeleteOpen(false),
  })
  const check = useResourceMutation({
    // The GET is the check: listLocalPosts reconciles against Google's live
    // list first, which is what resolves an ambiguous post one way or the
    // other. The invalidation is what re-renders the row.
    mutationFn: () => fetchPosts(locationId),
    invalidate,
    successToast: (state) => checkOutcomeTitle(state, post.id),
    errorContext: "post",
  })

  // Posts publish/approve/delete 503 when PUBLISH_ENABLED is off, so
  // gate every control on writesEnabled; live actions additionally need canPublish.
  const pausedReason = writesEnabled
    ? null
    : "Publishing to Google is currently unavailable."
  const publishReason =
    pausedReason ?? resourceDisabledReason(caps, "posts", writesEnabled)
  // The server routes a non-publisher's publish to `awaiting_approval`
  // (lib/server/posts.ts), so the same mutation submits for approval — the
  // reviews inbox does exactly this. Its disabled state must NOT come from
  // resourceDisabledReason: for precisely these users that resolves to
  // `publish_not_allowed` (lib/server/capabilities.ts), the gate the approval
  // flow exists to route around, which is why nothing in the product could
  // ever reach the approval half of the lifecycle.
  const offerRequestApproval = caps ? !caps.canPublish : false
  const primaryReason = offerRequestApproval ? pausedReason : publishReason
  const approveReason = resourceDisabledReason(caps, "posts", writesEnabled)
  const rejectReason = pausedReason
  // Deleting a live (published) post needs publish permission; a draft delete
  // still 503s when paused, so it is gated on writesEnabled too.
  const deleteReason = post.googlePostName
    ? resourceDisabledReason(caps, "posts", writesEnabled)
    : pausedReason

  return (
    <div className="flex flex-wrap items-center gap-2">
      {post.status === "draft" || post.status === "failed" ? (
        <Button
          size="sm"
          onClick={() => publish.mutate()}
          disabled={Boolean(primaryReason) || publish.isPending}
        >
          {offerRequestApproval ? "Request approval" : "Publish"}
        </Button>
      ) : null}
      {post.status === "ambiguous" ? (
        // Never Publish from 'ambiguous': the post's Google name is unknown,
        // so the republish is a blind `create` and Google ends up holding the
        // same update twice. Reading Google is the only safe next move.
        <Button
          size="sm"
          variant="outline"
          onClick={() => check.mutate()}
          disabled={check.isPending}
        >
          Check Google
        </Button>
      ) : null}
      {post.status === "awaiting_approval" ? (
        <>
          <Button
            size="sm"
            onClick={() => decide.mutate("approve")}
            disabled={Boolean(approveReason) || decide.isPending}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => decide.mutate("reject")}
            disabled={Boolean(rejectReason) || decide.isPending}
          >
            Reject
          </Button>
        </>
      ) : null}
      {post.status === "published" && post.googleSearchUrl ? (
        <a
          href={post.googleSearchUrl}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          View on Google
        </a>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setDeleteOpen(true)}
        disabled={Boolean(deleteReason) || remove.isPending}
      >
        Delete
      </Button>
      <OverwriteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this post?"
        description={
          post.googlePostName
            ? "This removes the post from your Google Business Profile."
            : "This deletes the draft."
        }
        confirmLabel="Delete"
        requireAcknowledgement={false}
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  )
}
