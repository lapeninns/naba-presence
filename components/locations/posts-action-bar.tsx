"use client"

import {
  ExternalLink,
  RefreshCwIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import { useState } from "react"

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  PostComposerSheet,
  postFormValues,
} from "@/components/locations/posts/post-composer-sheet"
import { PostPreview } from "@/components/locations/posts/post-preview"
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
import {
  contentEditDisabledReason,
  decideApprovalDisabledReason,
  resourceDisabledReason,
} from "@/lib/locations/gating"
import type { OutcomeMessage } from "@/lib/editors/outcome"
import { POST_ACTION_LABEL, postImageUrl } from "@/lib/locations/post-display"
import {
  DEFAULT_TIMEZONE,
  postRecurrence,
} from "@/lib/locations/post-recurrence"
import { queryKeys } from "@/lib/queries/keys"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"
import { cn } from "@/lib/utils"

function publishOutcome(status: string): OutcomeMessage {
  // Waiting for an approver: nothing has gone to Google yet.
  if (status === "awaiting_approval")
    return { outcome: "saved_locally", title: "Post submitted for approval." }
  // A rejected post is on Google and invisible to everyone, so the toast
  // must not say it was published.
  if (status === "rejected")
    return { outcome: "rejected", title: "Google rejected this post." }
  // "published" means Google took the post and did not reject it; it may
  // still be processing, so this is "sent", not "live".
  return { outcome: "sent", title: "Post sent to Google" }
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
  timezone = DEFAULT_TIMEZONE,
}: {
  locationId: string
  post: Post
  caps: LocationCapabilities | undefined
  writesEnabled: boolean
  /** The listing's IANA timezone, for when a repeat ends. */
  timezone?: string
}) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  // Approving publishes, so the approver sees exactly what goes to Google.
  const [approveOpen, setApproveOpen] = useState(false)
  const invalidate = [queryKeys.locationPosts(locationId)]

  const publish = useResourceMutation({
    mutationFn: () => publishPost(locationId, post.id),
    invalidate,
    successToast: (result) => publishOutcome(result.status),
    errorContext: "post",
    onSuccess: () => setPublishOpen(false),
    onError: () => setPublishOpen(false),
  })
  const decide = useResourceMutation({
    mutationFn: (decision: "approve" | "reject") =>
      // Bound to the revision on screen: an edit since the list loaded makes
      // the server refuse (approval_post_changed) rather than approve text
      // this approver never read.
      decidePostApproval(locationId, post.id, decision, post.contentRevision),
    invalidate,
    successToast: (result, decision) =>
      decision === "reject"
        ? "Sent back to draft"
        : publishOutcome(result.status),
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
  // A viewer may neither request approval nor edit (requireLocationAction
  // "request_approval" / "edit"), so the same button stays visible but
  // disabled with the reason.
  const offerRequestApproval = caps ? !caps.canPublish : false
  const editReason = contentEditDisabledReason(caps)
  const primaryReason = offerRequestApproval
    ? (pausedReason ?? editReason)
    : publishReason
  // Approve publishes, so it needs the posts resource to be writable as well
  // as the decide_approval authority; reject is local-only but is the same
  // decision, so it needs that authority too (never mere visibility).
  const decideReason = decideApprovalDisabledReason(caps)
  const approveReason =
    resourceDisabledReason(caps, "posts", writesEnabled) ?? decideReason
  const rejectReason = pausedReason ?? decideReason
  // Deleting a live (published) post needs publish permission; a draft delete
  // still 503s when paused, so it is gated on writesEnabled too, and it is an
  // edit, which a viewer may not make.
  const deleteReason = post.googlePostName
    ? resourceDisabledReason(caps, "posts", writesEnabled)
    : (pausedReason ?? editReason)

  const live = Boolean(post.googlePostName)
  // A post whose publish outcome is unknown has no Google name, so deleting
  // it is local only (lib/server/posts deleteLocalPost), yet Google may hold
  // a copy. Say so rather than promise Google never had it.
  const uncertainOnGoogle =
    post.status === "ambiguous" || post.status === "publishing"

  const editable = post.status === "draft" || post.status === "failed"
  const preview = postFormValues(post, timezone)

  const previewNode = (
    <PostPreview
            topicType={preview.topicType}
            summary={preview.summary}
            eventTitle={preview.eventTitle}
            schedule={
              preview.topicType !== "STANDARD" &&
              preview.startDate &&
              preview.endDate
                ? preview
                : null
            }
            actionLabel={
              preview.action ? POST_ACTION_LABEL[preview.action] : ""
            }
            recurrence={postRecurrence(post.event, timezone)}
      imageUrl={postImageUrl(post)}
          />
  )
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {editable ? (
        <Button
          size="sm"
          variant="secondary"
          // A request for approval sends nothing to Google, so it goes
          // straight through; a publish shows the post first.
          onClick={() =>
            offerRequestApproval ? publish.mutate() : setPublishOpen(true)
          }
          disabled={Boolean(primaryReason)}
          pending={publish.isPending}
          pendingLabel={offerRequestApproval ? "Requesting…" : "Publishing…"}
        >
          {post.status === "failed" && !offerRequestApproval ? (
            <RefreshCwIcon aria-hidden />
          ) : null}
          {offerRequestApproval
            ? "Request approval"
            : post.status === "failed"
              ? "Retry publish"
              : "Publish"}
        </Button>
      ) : null}
      {editable ? (
        // Editing a draft touches NabaPresence only, so the pause switch
        // that blocks Google writes doesn't block it; the edit grant does.
        <PostComposerSheet
          locationId={locationId}
          disabledReason={editReason}
          post={post}
          timezone={timezone}
        />
      ) : null}
      {post.status === "ambiguous" ? (
        // Never Publish from 'ambiguous': the post's Google name is unknown,
        // so the republish is a blind `create` and Google ends up holding the
        // same update twice. Reading Google is the only safe next move.
        <Button
          size="sm"
          variant="secondary"
          onClick={() => check.mutate()}
          pending={check.isPending}
          pendingLabel="Checking Google…"
        >
          Check Google
        </Button>
      ) : null}
      {post.status === "awaiting_approval" ? (
        <>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setApproveOpen(true)}
            disabled={Boolean(approveReason) || decide.isPending}
            pending={decide.isPending && decide.variables === "approve"}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => decide.mutate("reject")}
            disabled={Boolean(rejectReason) || decide.isPending}
            pending={decide.isPending && decide.variables === "reject"}
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
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          View on Google
          <ExternalLink aria-hidden />
        </a>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        className="text-danger-ink hover:not-data-disabled:bg-danger-tint"
        onClick={() => setDeleteOpen(true)}
        disabled={Boolean(deleteReason) || remove.isPending}
      >
        <Trash2Icon aria-hidden />
        Delete
      </Button>
      {primaryReason &&
      (post.status === "draft" || post.status === "failed") ? (
        <span className="w-full text-caption text-ink-muted">
          {primaryReason}
        </span>
      ) : null}
      <AlertDialog
        open={publishOpen}
        onOpenChange={(open) => {
          if (!publish.isPending) setPublishOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Publish this post to Google?</AlertDialogTitle>
          <AlertDialogDescription>
            Customers see it on the listing as soon as Google accepts it. To
            change it afterwards, edit it here and it is sent again.
          </AlertDialogDescription>
          {previewNode}
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button variant="ghost">Not yet</Button>}
            />
            <Button
              onClick={() => publish.mutate()}
              pending={publish.isPending}
              pendingLabel="Publishing…"
            >
              <UploadIcon aria-hidden />
              Publish to Google
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={approveOpen}
        onOpenChange={(open) => {
          if (!decide.isPending) setApproveOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Approve and publish this post?</AlertDialogTitle>
          <AlertDialogDescription>
            Approving sends exactly this post to Google. Customers see it once Google accepts it.
          </AlertDialogDescription>
          {previewNode}
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost">Not yet</Button>} />
            <Button
              onClick={() => decide.mutate("approve", { onSettled: () => setApproveOpen(false) })}
              pending={decide.isPending && decide.variables === "approve"}
              pendingLabel="Publishing…"
            >
              <UploadIcon aria-hidden />
              Approve and publish
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!remove.isPending) setDeleteOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>
            {live ? "Delete this post from Google?" : "Delete this post?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {live
              ? "This removes the post from your Google Business Profile. Customers stop seeing it straight away, and it can’t be undone."
              : uncertainOnGoogle
                ? "This deletes the post from NabaPresence."
                : "This deletes the draft."}
          </AlertDialogDescription>
          {live ? null : (
            <p className="text-ui text-ink-muted">
              {post.status === "ambiguous"
                ? "Deleting here doesn’t touch Google. If Google did receive this post, it stays there; use Check Google first to find out."
                : post.status === "publishing"
                  ? // No Check Google here: that action is only offered once
                    // the publish outcome is known to be ambiguous.
                    "Deleting here doesn’t touch Google. This post is still being sent, so if Google receives it, it stays there."
                  : "Only NabaPresence has it, so Google is not affected."}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button variant="ghost">Keep it</Button>}
            />
            <Button
              variant="danger"
              onClick={() => remove.mutate()}
              pending={remove.isPending}
              pendingLabel={live ? "Deleting from Google…" : "Deleting…"}
            >
              {live ? "Delete from Google" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
