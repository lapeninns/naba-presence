"use client"

import { useState } from "react"

import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import { decidePostApproval, deletePost, publishPost, type Post } from "@/lib/api/location-posts"
import type { LocationCapabilities } from "@/lib/contracts/location-capabilities"
import { resourceDisabledReason } from "@/lib/locations/gating"
import { queryKeys } from "@/lib/queries/keys"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"

function publishOutcomeTitle(status: string) {
  return status === "awaiting_approval" ? "Post submitted for approval." : "Post published to Google"
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
    mutationFn: (decision: "approve" | "reject") => decidePostApproval(locationId, post.id, decision),
    invalidate,
    successToast: (result, decision) => (decision === "reject" ? "Sent back to draft" : publishOutcomeTitle(result.status)),
    errorContext: "post",
  })
  const remove = useResourceMutation({
    mutationFn: () => deletePost(locationId, post.id),
    invalidate,
    successToast: "Post deleted",
    errorContext: "post",
    onSuccess: () => setDeleteOpen(false),
  })

  // Posts publish/approve/delete 503 when PUBLISH_ENABLED is off, so
  // gate every control on writesEnabled; live actions additionally need canPublish.
  const pausedReason = writesEnabled ? null : "Publishing to Google is currently unavailable."
  const publishReason =
    pausedReason ?? resourceDisabledReason(caps, "posts", writesEnabled)
  const approveReason = resourceDisabledReason(caps, "posts", writesEnabled)
  const rejectReason = pausedReason
  // Deleting a live (published) post needs publish permission; a draft delete
  // still 503s when paused, so it is gated on writesEnabled too.
  const deleteReason = post.googlePostName
    ? resourceDisabledReason(caps, "posts", writesEnabled)
    : pausedReason

  return (
    <div className="flex flex-wrap items-center gap-2">
      {(post.status === "draft" || post.status === "failed" || post.status === "ambiguous") ? (
        <Button size="sm" onClick={() => publish.mutate()} disabled={Boolean(publishReason) || publish.isPending}>
          Publish
        </Button>
      ) : null}
      {post.status === "awaiting_approval" ? (
        <>
          <Button size="sm" onClick={() => decide.mutate("approve")} disabled={Boolean(approveReason) || decide.isPending}>
            Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => decide.mutate("reject")} disabled={Boolean(rejectReason) || decide.isPending}>
            Reject
          </Button>
        </>
      ) : null}
      {post.status === "published" && post.googleSearchUrl ? (
        <a href={post.googleSearchUrl} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          View on Google
        </a>
      ) : null}
      <Button size="sm" variant="ghost" onClick={() => setDeleteOpen(true)} disabled={Boolean(deleteReason) || remove.isPending}>
        Delete
      </Button>
      <OverwriteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this post?"
        description={post.googlePostName ? "This removes the post from your Google Business Profile." : "This deletes the draft."}
        confirmLabel="Delete"
        requireAcknowledgement={false}
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  )
}
