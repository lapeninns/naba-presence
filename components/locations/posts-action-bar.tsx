"use client"

import { useMutation } from "@tanstack/react-query"
import { useState } from "react"

import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import { decidePostApproval, deletePost, publishPost, type Post } from "@/lib/api/location-posts"
import { describeActionError } from "@/lib/locations/action-errors"
import { resourceDisabledReason } from "@/lib/locations/gating"

function describePublishOutcome(status: string) {
  return status === "awaiting_approval"
    ? { title: "Post submitted for approval.", type: "success" as const }
    : { title: "Post published to Google", type: "success" as const }
}

export function PostsActionBar({
  locationId,
  post,
  caps,
  writesEnabled,
  invalidate,
  toast,
}: {
  locationId: string
  post: Post
  caps: { canEditCanonical: boolean; canPublish: boolean } | undefined
  writesEnabled: boolean
  invalidate: () => void
  toast: (title: string, type: "success" | "error") => void
}) {
  const [deleteOpen, setDeleteOpen] = useState(false)

  const publish = useMutation({
    mutationFn: () => publishPost(locationId, post.id),
    onSuccess: (result) => {
      const outcome = describePublishOutcome(result.status)
      invalidate()
      toast(outcome.title, outcome.type)
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })
  const decide = useMutation({
    mutationFn: (decision: "approve" | "reject") => decidePostApproval(locationId, post.id, decision),
    onSuccess: (result, decision) => {
      invalidate()
      toast(decision === "reject" ? "Sent back to draft" : describePublishOutcome(result.status).title, "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })
  const remove = useMutation({
    mutationFn: () => deletePost(locationId, post.id),
    onSuccess: () => {
      setDeleteOpen(false)
      invalidate()
      toast("Post deleted", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
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
