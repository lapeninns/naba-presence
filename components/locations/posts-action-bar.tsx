"use client"

import {
  CalendarClock,
  ExternalLink,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  Trash2Icon,
  UndoIcon,
  UploadIcon,
} from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import dynamic from "next/dynamic"
import { useState } from "react"

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { postFormValues } from "@/components/locations/posts/post-form-values"
import { useDeferredSheet } from "@/components/locations/posts/use-deferred-sheet"
import {
  OperationReceiptNotice,
  unconfirmedReceiptId,
} from "@/components/locations/operation-outcome"
import {
  postPublishGate,
  publishOutcome,
  publishToast,
} from "@/components/locations/posts/post-publish"
import { PostPreview } from "@/components/locations/posts/post-preview"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ApiClientError } from "@/lib/api/client"
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
import { useOutcomeToast } from "@/components/ui/toast"
import { errorOutcome } from "@/lib/errors/action-errors"
import { POST_ACTION_LABEL, postImageUrl } from "@/lib/locations/post-display"
import {
  DEFAULT_TIMEZONE,
  postRecurrence,
} from "@/lib/locations/post-recurrence"
import { queryKeys } from "@/lib/queries/keys"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"
import { cn } from "@/lib/utils"

// Each post row can edit and schedule, but few rows ever do: the two sheets
// load (and mount) the first time one is asked to open, and opening the
// row's menu starts the load.
const loadComposer = () =>
  import("@/components/locations/posts/post-composer-sheet")
const loadScheduler = () =>
  import("@/components/locations/posts/schedule-post-sheet")
const PostComposerSheet = dynamic(
  () =>
    import("@/components/locations/posts/post-composer-sheet").then(
      (m) => m.PostComposerSheet
    ),
  { ssr: false }
)
const SchedulePostSheet = dynamic(
  () =>
    import("@/components/locations/posts/schedule-post-sheet").then(
      (m) => m.SchedulePostSheet
    ),
  { ssr: false }
)

export { publishOutcome }

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

/**
 * A post's actions: ONE visible action — the next step for the post as it
 * stands (Publish / Request approval / Retry, Approve, Check Google, or View
 * on Google) — and everything else in a "More actions" menu (an action sheet
 * on a phone): Edit, Schedule, Reject, then Delete last, which still asks
 * first. Every action keeps its gate, and a disabled one says why in words:
 * under the visible action, and on the menu row itself.
 */
export function PostsActionBar({
  locationId,
  post,
  label,
  caps,
  writesEnabled,
  timezone = DEFAULT_TIMEZONE,
  scheduling,
}: {
  locationId: string
  post: Post
  /** How the menu names the post ("More actions for Quiz night"). */
  label?: string
  caps: LocationCapabilities | undefined
  writesEnabled: boolean
  /** The listing's IANA timezone, for when a repeat ends. */
  timezone?: string
  /**
   * Set when the organisation schedules posts (P08-R5): Publish reads
   * "Publish now" beside Schedule, and a post with a one-time schedule
   * (`scheduledFor`, its description) says that publishing now replaces it.
   */
  scheduling?: {
    scheduledFor: string | null
    /**
     * Offer "Schedule publication" for this post (the list decides: a
     * schedulable post with no schedule, and an editor's role).
     */
    canSchedule?: boolean
    /** caps.postSchedulingRecurring: repeating schedules may be offered. */
    recurring?: boolean
  }
}) {
  const queryClient = useQueryClient()
  const outcomeToast = useOutcomeToast()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  // Approving publishes, so the approver sees exactly what goes to Google.
  const [approveOpen, setApproveOpen] = useState(false)
  const composer = useDeferredSheet()
  const scheduler = useDeferredSheet()
  const name = label || post.summary.slice(0, 60) || "this post"
  const invalidate = [queryKeys.locationPosts(locationId)]

  const publish = useResourceMutation({
    mutationFn: (_: void, intent) =>
      // Bound to the revision on screen (the preview the person confirmed):
      // an edit since the list loaded makes the server refuse
      // (post_changed_since_saved) rather than publish text they never saw.
      publishPost(locationId, post.id, {
        intentId: intent.intentId,
        expectedRevision: post.contentRevision,
      }),
    // The publish sends the post as it is now, so a retry is the same action
    // only while the post is the same revision; an edit mints a new intent.
    intentKey: () => [post.id, post.contentRevision],
    invalidate,
    errorContext: "post",
    onSuccess: (result) => {
      setPublishOpen(false)
      outcomeToast.show(publishToast(result))
    },
    onError: (error) => {
      setPublishOpen(false)
      // The row on screen is what changed: read it again so the next
      // Publish names the current revision.
      if (
        error instanceof ApiClientError &&
        error.code === "post_changed_since_saved"
      )
        void queryClient.invalidateQueries({
          queryKey: queryKeys.locationPosts(locationId),
        })
    },
  })
  const decide = useResourceMutation({
    mutationFn: (decision: "approve" | "reject", intent) =>
      // Bound to the revision on screen: an edit since the list loaded makes
      // the server refuse (approval_post_changed) rather than approve text
      // this approver never read.
      decidePostApproval(locationId, post.id, decision, post.contentRevision, {
        intentId: intent.intentId,
      }),
    // A retry after a lost answer resends the intent, so an approval that
    // already published is answered with its outcome, not a 409.
    intentKey: (decision) => [post.id, decision, post.contentRevision],
    invalidate,
    // Rejecting only changes NabaPresence (a plain toast); approving
    // publishes, so its toast is a Google write.
    successToast: (_, decision) =>
      decision === "reject" ? "Sent back to draft" : null,
    errorContext: "post",
    onSuccess: (result, decision) => {
      if (decision === "approve") outcomeToast.show(publishToast(result))
    },
  })
  const remove = useResourceMutation({
    // A retry after a lost answer resends the intent, so a delete that
    // already landed is answered as deleted, not a 404.
    mutationFn: (_: void, intent) =>
      deletePost(locationId, post.id, { intentId: intent.intentId }),
    intentKey: () => post.id,
    invalidate,
    errorContext: "post",
    onSuccess: () => {
      setDeleteOpen(false)
      // Deleting a live post removes it from Google: a Google write. A
      // draft's delete touches NabaPresence only.
      outcomeToast.show(
        post.googlePostName
          ? { title: "Post deleted", kind: "google" }
          : { title: "Post deleted" }
      )
    },
  })
  const check = useResourceMutation({
    // The GET is the check: listLocalPosts reconciles against Google's live
    // list first, which is what resolves an ambiguous post one way or the
    // other. It asks after this post alone, which may not be on the first
    // page. The invalidation is what re-renders the row.
    mutationFn: () => fetchPosts(locationId, { post: post.id }),
    invalidate,
    successToast: (state) => checkOutcomeTitle(state, post.id),
    errorContext: "post",
  })

  // Posts publish/approve/delete 503 when PUBLISH_ENABLED is off, so
  // gate every control on writesEnabled; live actions additionally need canPublish.
  // A non-publisher's publish is a request for approval (see postPublishGate).
  const {
    pausedReason,
    requestApproval: offerRequestApproval,
    reason: primaryReason,
  } = postPublishGate(caps, writesEnabled)
  const editReason = contentEditDisabledReason(caps)
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
  // A publish whose answer was lost or ambiguous: follow its receipt until
  // the recovery job settles it, then re-read the post.
  const receiptId = unconfirmedReceiptId(publish.error)

  const previewNode = (
    <PostPreview
      topicType={preview.topicType}
      summary={preview.summary}
      eventTitle={preview.eventTitle}
      schedule={
        preview.topicType !== "STANDARD" && preview.startDate && preview.endDate
          ? preview
          : null
      }
      actionLabel={preview.action ? POST_ACTION_LABEL[preview.action] : ""}
      recurrence={postRecurrence(post.event, timezone)}
      imageUrl={postImageUrl(post)}
    />
  )
  const publishLabel = offerRequestApproval
    ? "Request approval"
    : post.status === "failed"
      ? "Retry publish"
      : scheduling
        ? "Publish now"
        : "Publish"
  const canSchedule = Boolean(scheduling?.canSchedule)
  const awaiting = post.status === "awaiting_approval"
  // The visible action's reason, in words beside it.
  const shownReason = editable ? primaryReason : awaiting ? approveReason : null

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
          {publishLabel}
        </Button>
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
      {awaiting ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setApproveOpen(true)}
          disabled={Boolean(approveReason) || decide.isPending}
          pending={decide.isPending && decide.variables === "approve"}
        >
          Approve
        </Button>
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

      <DropdownMenu
        onOpenChange={(open) => {
          if (!open) return
          if (editable) void loadComposer()
          if (canSchedule) void loadScheduler()
        }}
      >
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`More actions for ${name}`}
            />
          }
        >
          <MoreHorizontalIcon aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent title={name} className="max-w-xs">
          {editable ? (
            // Editing a draft touches NabaPresence only, so the pause switch
            // that blocks Google writes doesn't block it; the edit grant does.
            <DropdownMenuItem
              disabledReason={editReason ?? undefined}
              onClick={composer.open}
            >
              <PencilIcon aria-hidden />
              Edit
            </DropdownMenuItem>
          ) : null}
          {canSchedule ? (
            <DropdownMenuItem onClick={scheduler.open}>
              <CalendarClock aria-hidden />
              Schedule publication
            </DropdownMenuItem>
          ) : null}
          {awaiting ? (
            <DropdownMenuItem
              disabledReason={
                rejectReason ??
                (decide.isPending ? "Deciding…" : null) ??
                undefined
              }
              onClick={() => decide.mutate("reject")}
            >
              <UndoIcon aria-hidden />
              Reject
            </DropdownMenuItem>
          ) : null}
          {editable || canSchedule || awaiting ? (
            <DropdownMenuSeparator />
          ) : null}
          <DropdownMenuItem
            variant="destructive"
            disabledReason={
              deleteReason ??
              (remove.isPending ? "Deleting…" : null) ??
              undefined
            }
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2Icon aria-hidden />
            {live ? "Delete from Google" : "Delete"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {editable && composer.mounted ? (
        <PostComposerSheet
          locationId={locationId}
          disabledReason={editReason}
          post={post}
          timezone={timezone}
          openRef={composer.openRef}
          caps={caps}
          writesEnabled={writesEnabled}
        />
      ) : null}
      {canSchedule && scheduler.mounted ? (
        <SchedulePostSheet
          locationId={locationId}
          post={post}
          timezone={timezone}
          recurring={scheduling?.recurring === true}
          openRef={scheduler.openRef}
        />
      ) : null}
      {receiptId ? (
        <OperationReceiptNotice
          className="w-full"
          receiptId={receiptId}
          fallback={errorOutcome(publish.error)}
          onSettled={() => {
            void queryClient.invalidateQueries({
              queryKey: queryKeys.locationPosts(locationId),
            })
          }}
        />
      ) : null}
      {shownReason ? (
        <span className="w-full text-caption text-ink-muted">
          {shownReason}
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
          {scheduling?.scheduledFor ? (
            <p className="text-ui text-ink">
              This post is also scheduled ({scheduling.scheduledFor}).
              Publishing it now means the scheduled publication does not run.
            </p>
          ) : null}
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
            Approving sends exactly this post to Google. Customers see it once
            Google accepts it.
          </AlertDialogDescription>
          {previewNode}
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button variant="ghost">Not yet</Button>}
            />
            <Button
              onClick={() =>
                decide.mutate("approve", {
                  onSettled: () => setApproveOpen(false),
                })
              }
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
