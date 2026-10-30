"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CircleAlertIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { PageHeader } from "@/components/app-shell/page-frame"
import { OperationReceiptNotice } from "@/components/locations/operation-outcome"
import { ActionBar } from "@/components/ui/action-bar"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import { cardClassName, cardLinkClassName } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { FormError } from "@/components/ui/field"
import { ListRow } from "@/components/ui/list-row"
import { Progress } from "@/components/ui/progress"
import { QueryStates, queryStatus } from "@/components/ui/query-states"
import { StatusPill, type PillTone } from "@/components/ui/status-pill"
import { ApiClientError } from "@/lib/api/client"
import {
  approveBulkChange,
  cancelBulkChange,
  fetchBulkChange,
  previewBulkChange,
  retryBulkChange,
  startBulkChange,
} from "@/lib/api/bulk-listings"
import type {
  BulkChild,
  BulkOperationView as Operation,
} from "@/lib/contracts/bulk-listings"
import { isBulkReviewOperation } from "@/lib/domain/bulk-reviews"
import {
  formatCountdown,
  newPreviewRequest,
  secondsLeft,
  serverClockOffset,
} from "@/lib/domain/bulk-repreview"
import { formatDateTime } from "@/lib/format"
import { formatTimeOfDay } from "@/lib/format/time"
import { cn } from "@/lib/utils"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
import { useSession, useSessionRole } from "@/lib/queries/use-session"

import { describeChildChange, maskLabel } from "./bulk-change-summary"

const CHILD: Record<BulkChild["status"], { label: string; tone: PillTone }> = {
  previewed: { label: "Ready", tone: "info" },
  skipped: { label: "Skipped", tone: "outline" },
  queued: { label: "Queued", tone: "info" },
  running: { label: "Sending", tone: "info" },
  succeeded: { label: "Confirmed", tone: "ok" },
  failed: { label: "Failed", tone: "bad" },
  conflict: { label: "Changed on Google", tone: "warn" },
  ambiguous: { label: "Outcome unknown", tone: "warn" },
  cancelled: { label: "Cancelled", tone: "outline" },
  expired: { label: "Expired, not sent", tone: "outline" },
}
const REASON: Record<string, string> = {
  already_applied: "Already shows this change",
  publish_not_allowed: "You can’t publish to this listing",
  attribute_not_offered: "Its category doesn’t offer this attribute",
  attribute_value_not_supported: "Google doesn’t accept this value here",
  hours_type_not_supported: "Google doesn’t offer this hours type here",
  action_type_not_supported: "Google doesn’t offer this action type here",
  link_not_found: "No link of this type to remove",
  multiple_links_for_type:
    "Several links of this type; change this listing on its own",
  hours_reconciliation_required:
    "Its saved hours need reviewing in the hours editor first",
  provider_owned: "The link belongs to a booking provider",
  google_baseline_changed:
    "Changed on Google after the preview; prepare a new preview",
  permission_revoked: "Approval no longer valid: access changed",
  approval_policy_changed: "The approval policy changed",
  second_approver_required:
    "Not sent: two-person approval needs a different approver",
  security_version_unverifiable:
    "Not sent: the approver’s sign-in couldn’t be verified",
  entitlement_unverifiable: "Not sent: the plan couldn’t be verified",
  execution_interrupted:
    "Interrupted; retry reads Google before anything is sent again",
  response_ambiguous: "Google’s response was lost; retry reads Google first",
  readback_mismatch: "Google doesn’t show the change yet",
  readback_failed: "Google couldn’t be read to confirm",
  google_rate_limited: "Waiting for Google quota",
  publishing_paused: "Publishing is paused",
  billing_read_only: "Waiting: the subscription is read-only",
  dispatch_expired:
    "Not sent: the approval lasts 24 hours; prepare a new preview",
  preview_expired:
    "Not sent: the preview wasn’t approved within 15 minutes; prepare a new preview",
  google_target_changed:
    "The Google connection changed after the preview; prepare a new preview",
  resource_busy: "Waiting for another change to this listing to finish",
  feature_disabled: "Bulk changes are switched off for this workspace",
  dependency_not_applied:
    "Not sent: an earlier change it needs didn’t apply to this listing",
  permanently_closed:
    "Permanently closed on Google; reopen it from this listing’s own page",
  category_missing: "No primary category; choose one for this change",
  too_many_categories: "Would have more than 9 additional categories",
  category_region_unknown:
    "Google’s categories for this listing’s country couldn’t be found",
  category_not_available:
    "Google doesn’t offer one of these categories in this listing’s country",
  lodging_not_available: "Google keeps no lodging details for this listing",
  food_menus_not_eligible: "Google doesn’t allow menus for this listing",
  food_menus_local_changes:
    "Its menu has unpublished edits; publish or discard them in the menu editor first",
  menu_node_not_found: "A menu entry this change names isn’t on this listing",
  menu_node_ambiguous:
    "A menu entry this change names appears more than once here; change this listing on its own",
  menu_parent_mismatch: "An added entry doesn’t fit where it’s placed",
  menu_changes_overlap:
    "The change edits or adds inside an entry it also removes",
  asset_not_found: "The photo isn’t in this workspace’s uploads",
  asset_not_ready: "The photo upload wasn’t finished or was refused",
  asset_changed: "The photo changed after the preview; preview again",
  asset_integrity_failed:
    "The stored photo doesn’t match what was checked; upload it again",
  asset_storage_unavailable: "Photo storage isn’t available right now",
  photo_publication_pending:
    "This photo is still being added to this listing by another change",
  photo_already_added: "This photo was added to this listing after the preview",
  media_needs_resolution:
    "Google didn’t confirm the photo; check the listing’s photos and resolve it there",
  media_create_in_progress: "This photo is still being added to Google",
  // Post drafts: content checks run again as each listing's draft is made.
  content_checks_failed:
    "Not drafted: the post no longer passes the content checks; edit it and prepare a new preview",
  content_warning_acknowledgement_required:
    "Not drafted: its content warnings changed after the preview; prepare a new preview and acknowledge them",
  // Review replies (P09-R8).
  submitted_for_approval: "Submitted for approval; nothing sent to Google yet",
  approval_withdrawn:
    "Not sent: the approval was withdrawn or replaced after this batch started",
  approval_not_sufficient:
    "Not sent: this reply now needs another approval; it is waiting in the inbox",
  review_changed: "The review changed after this batch started; open it",
  approval_draft_changed: "The reply changed after it was approved; open it",
  approval_not_pending: "No longer waiting for approval",
  publish_retry_scheduled:
    "Google asked us to wait; the reply is resent automatically",
  publish_in_progress: "Another publish of this reply is still finishing",
  google_reply_rejected: "Google rejected the reply",
  verification_failed: "The template reply didn’t pass its checks; open it",
  verification_required: "The template reply’s checks didn’t finish; open it",
  template_review_has_text: "The review has text, so it needs a personal reply",
  template_review_busy: "The review already has a draft or a reply under way",
  template_has_reply: "The review already has a reply",
  template_has_draft: "The review already has a draft",
  template_low_rating: "1 or 2 stars, left for a personal reply",
  review_restricted: "The review is restricted from replies",
  review_not_found: "The review is no longer available",
  publish_superseded: "Replaced by a later publish of this reply",
  drafts_paused: "Drafting is paused",
}
const reason = (code: string | null) =>
  code
    ? (REASON[code] ??
      (code.startsWith("provider_rejected")
        ? "Google rejected the change"
        : code.startsWith("recovered_not_applied")
          ? "Checked on Google: the change didn’t apply; retry to send it"
          : code.replaceAll("_", " ")))
    : null
const OPERATION_LABEL: Record<Operation["operation"], string> = {
  regular_hours: "Opening hours",
  special_hours: "Special hours",
  more_hours: "Service hours",
  attributes: "Attributes",
  place_action: "Action link",
  business_info: "Business information",
  categories: "Categories",
  lodging: "Lodging details",
  food_menus: "Menus",
  post_draft: "Post drafts",
  photos: "Photos",
  review_approval: "Approved replies",
  review_template_reply: "Template replies",
  mixed: "Several changes",
}

/**
 * One bulk change: its frozen preview, approval, progress and per-listing
 * outcomes. A batch is not all-or-nothing: confirmed listings stay changed
 * when others fail, and cancelling stops only listings not yet started.
 */
export function BulkOperationView({ operationId }: { operationId: string }) {
  const role = useSessionRole()
  const userId = useSession().data?.session?.userId ?? null
  const manager = role === "owner" || role === "admin"
  const client = useQueryClient()
  const router = useRouter()
  const [acknowledged, setAcknowledged] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  /** What the last action did when that is not visible elsewhere (a retry that requeued nothing). */
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const query = useQuery({
    queryKey: queryKeys.bulkChange(operationId),
    queryFn: (context) => fetchBulkChange(operationId, requestOptions(context)),
    // While anything is still moving: a running batch, and a cancelled (or
    // just-started) one whose listings already sending have yet to settle.
    refetchInterval: (state) => (moving(state.state.data) ? 5_000 : false),
  })
  const mutate = useMutation({
    onMutate: () => {
      setNotice(null)
      return { before: query.data }
    },
    mutationFn: (action: "approve" | "start" | "cancel" | "retry") => {
      const op = query.data!
      return action === "approve"
        ? approveBulkChange(op.id, op.previewHash, acknowledged)
        : action === "start"
          ? startBulkChange(op.id)
          : action === "cancel"
            ? cancelBulkChange(op.id)
            : retryBulkChange(op.id)
    },
    onSuccess: (data, action, context) => {
      setFailure(null)
      client.setQueryData(queryKeys.bulkChange(operationId), data)
      void client.invalidateQueries({ queryKey: queryKeys.bulkChanges })
      // A retry requeues only what can be sent again; say so when that was
      // nothing, rather than leave the same failures with no word.
      if (action === "retry" && context?.before) {
        const before = new Map(
          context.before.children.map((child) => [child.id, child.status])
        )
        const requeued = data.children.some(
          (child) =>
            (before.get(child.id) === "failed" ||
              before.get(child.id) === "ambiguous") &&
            child.status !== before.get(child.id)
        )
        if (!requeued)
          setNotice(
            "Nothing could be retried yet: these listings need a new preview or are still being checked on Google."
          )
      }
    },
    onError: (error) => {
      setFailure(
        error instanceof ApiClientError
          ? error.message
          : "That action could not be completed."
      )
      // Someone else moved the batch on (approved, started, cancelled it, or
      // the preview changed): read it again so the buttons match the server.
      if (error instanceof ApiClientError && error.status === 409)
        void query.refetch()
    },
  })
  const op = query.data
  // The 15-minute approval window, counted down on the page; once it closes
  // the preview cannot be approved and Google must be read again. Counted
  // by the server's clock (its time when it answered, carried forward), so
  // a wrong browser clock neither closes the window early nor shows time
  // the server would refuse; the server still decides at approval.
  const now = useNow(op?.status === "previewed")
  const offset = serverClockOffset(op?.serverTime, query.dataUpdatedAt)
  const previewClosed =
    op?.status === "previewed" &&
    secondsLeft(op.previewExpiresAt, now, offset) === 0
  const repreview = op ? newPreviewRequest(op, { previewClosed }) : null
  const prepare = useMutation({
    mutationFn: () =>
      previewBulkChange({
        locationIds: repreview!.locationIds,
        items: repreview!.items,
      }),
    onSuccess: (next) => {
      void client.invalidateQueries({ queryKey: queryKeys.bulkChanges })
      router.push(`/listings/bulk/${next.id}`)
    },
    onError: (error) =>
      setFailure(
        error instanceof ApiClientError
          ? error.message
          : "The new preview could not be prepared. Try again."
      ),
  })
  const listings = new Set(op?.children.map((child) => child.locationId)).size
  const multiple = (op?.items.length ?? 1) > 1
  const unit = (count: number) =>
    multiple
      ? count === 1
        ? "change"
        : "changes"
      : count === 1
        ? "listing"
        : "listings"
  const skipped =
    op?.children.filter((child) => child.eligibility === "skipped").length ?? 0
  const retryable =
    op?.children.filter(
      (child) => child.status === "failed" || child.status === "ambiguous"
    ).length ?? 0

  // Why Approve can't be used now, on the button and in the bar's words.
  const approveBlocked = !op
    ? undefined
    : previewClosed
      ? "This preview expired; prepare a new one"
      : !op.canApprove
        ? "A different owner or administrator must approve"
        : skipped > 0 && !acknowledged
          ? `Tick the box about the skipped ${unit(skipped)} to approve`
          : undefined
  const canRepreview = Boolean(
    manager &&
    op &&
    repreview?.items.length &&
    !isBulkReviewOperation(op.operation)
  )
  // Who may stop or retry a batch, as the server decides it
  // (requireBatchControl): an owner or admin, or the member who started a
  // review batch, since they are its only decider. Approving and starting
  // stay with owners and admins.
  const canControl = Boolean(
    op &&
    (manager ||
      (role === "member" &&
        isBulkReviewOperation(op.operation) &&
        userId !== null &&
        op.requestedBy === userId))
  )
  // Listings a cancel stops (not yet sent) and those it leaves (already
  // sending, already confirmed), from the server's counts.
  const unsent = (op?.counts.previewed ?? 0) + (op?.counts.queued ?? 0)
  const sending = op?.counts.running ?? 0
  // The quiet actions first and the one primary last (nearest the thumb on
  // a phone): approving while the window is open, starting once approved,
  // or the new preview once Google must be read again.
  const buttons =
    canControl && op
      ? [
          op.status === "running" ||
          op.status === "approved" ||
          op.status === "previewed" ? (
            <Button
              key="cancel"
              variant="ghost-dark"
              disabled={mutate.isPending}
              onClick={() => setConfirmingCancel(true)}
            >
              {op.status === "previewed"
                ? "Discard this preview"
                : "Stop listings not yet sent"}
            </Button>
          ) : null,
          retryable &&
          ["running", "completed_with_failures"].includes(op.status) ? (
            <Button
              key="retry"
              variant="ghost-dark"
              disabled={mutate.isPending}
              onClick={() => {
                setFailure(null)
                mutate.mutate("retry")
              }}
            >
              Retry {retryable} unconfirmed {unit(retryable)}
            </Button>
          ) : null,
          canRepreview && repreview ? (
            <Button
              key="repreview"
              variant={
                previewClosed || op.status === "expired"
                  ? "default"
                  : "ghost-dark"
              }
              pending={prepare.isPending}
              pendingLabel="Reading each listing…"
              onClick={() => {
                setFailure(null)
                prepare.mutate()
              }}
            >
              New preview for {repreview.locationIds.length}{" "}
              {repreview.locationIds.length === 1 ? "listing" : "listings"} not
              sent
            </Button>
          ) : null,
          manager && op.status === "previewed" ? (
            <Button
              key="approve"
              variant={previewClosed ? "ghost-dark" : "default"}
              disabledReason={approveBlocked}
              pending={mutate.isPending}
              onClick={() => {
                setFailure(null)
                mutate.mutate("approve")
              }}
            >
              Approve this exact change
            </Button>
          ) : null,
          manager && op.status === "approved" ? (
            <Button
              key="start"
              pending={mutate.isPending}
              onClick={() => {
                setFailure(null)
                mutate.mutate("start")
              }}
            >
              Start bulk change
            </Button>
          ) : null,
        ].filter(Boolean)
      : []
  const actions = buttons.length ? <>{buttons}</> : null
  // What the bar says beside its buttons, where the thumb is on a phone:
  // the last action's error, a retry that moved nothing, or why Approve
  // can't be used. Nothing otherwise, so the bar keeps its one row.
  const barStatus =
    failure ??
    notice ??
    (manager && op?.status === "previewed" ? approveBlocked : undefined)
  const notFound =
    query.error instanceof ApiClientError &&
    query.error.status === 404 &&
    query.error.code !== "feature_disabled"
  // Progress once the change is under way: how many of its listing changes
  // Google has confirmed, from the same counts the status line reads. A
  // skipped listing is never sent, so it is not part of the total.
  const total = (op?.children.length ?? 0) - skipped
  const confirmed = op?.counts.succeeded ?? 0
  const showProgress =
    Boolean(op) && op?.status !== "previewed" && op?.status !== "expired"

  return (
    <>
      <PageHeader
        title={
          op
            ? `${OPERATION_LABEL[op.operation]} across ${listings} ${listings === 1 ? "listing" : "listings"}`
            : "Bulk change"
        }
        description="Each listing is read from Google, changed once and confirmed by reading it back. Listings are independent: one failing does not undo another."
        actions={
          <Link
            href="/listings"
            className={buttonVariants({ variant: "secondary" })}
          >
            Back to listings
          </Link>
        }
      />
      {/* A failed refresh keeps the last batch the server sent on screen
          (labelled below as such); only a first load that fails is an
          error page. A batch that isn't there, or isn't this person's,
          offers no retry that could not succeed. */}
      <QueryStates
        status={queryStatus({
          isPending: query.isPending,
          isError: query.isError && !query.data,
        })}
        pendingLabel="bulk change"
        error={
          notFound
            ? {
                title: "This bulk change wasn’t found",
                description:
                  "It may belong to someone else, or the link is wrong. Bulk changes you can see open from their notification or from the inbox.",
              }
            : "The bulk change could not be loaded"
        }
        onRetry={notFound ? undefined : () => void query.refetch()}
      >
        {op ? (
          <div
            // The docked phone bar's spacer (its measured height) goes under
            // the last outcome, not between the summary and the list, where
            // the bar sits in the reading order.
            className="flex min-w-0 flex-col gap-4 max-md:[&>[data-slot=action-bar-spacer]]:order-last"
          >
            {/* The summary: what is true now in words, progress once it
                runs, and the window that applies. */}
            <div
              className={cardClassName({
                className: "flex min-w-0 flex-col gap-3 p-4",
              })}
            >
              <p className="text-ui text-ink" role="status">
                {op.status === "previewed"
                  ? "Waiting for approval."
                  : op.status === "approved"
                    ? "Approved. Start it to queue each listing."
                    : op.status === "running"
                      ? "Running. This page updates on its own; you can leave it."
                      : op.status === "completed"
                        ? "Every eligible listing is confirmed."
                        : op.status === "completed_with_failures"
                          ? "Finished with some listings not changed."
                          : op.status === "cancelled"
                            ? "Cancelled. Listings already confirmed keep their change."
                            : "This change expired. Nothing more will be sent; prepare a new preview."}{" "}
                {Object.entries(op.counts)
                  .map(
                    ([status, count]) =>
                      `${count} ${CHILD[status as BulkChild["status"]]?.label.toLowerCase() ?? status}`
                  )
                  .join(" · ")}
              </p>
              {showProgress && total > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <p
                    id="bulk-progress-label"
                    className="text-caption text-ink-muted tabular-nums"
                  >
                    {`${confirmed} of ${total} ${unit(total)} confirmed on Google`}
                  </p>
                  <Progress
                    value={confirmed}
                    max={total}
                    aria-labelledby="bulk-progress-label"
                  />
                </div>
              ) : null}
              {op.status === "cancelled" && sending > 0 ? (
                <p className="text-caption text-ink-muted">
                  {`${sending} ${unit(sending)} ${sending === 1 ? "is" : "are"} still finishing; this page updates on its own.`}
                </p>
              ) : null}
              <Deadline operation={op} now={now} offset={offset} />
              {query.isRefetchError ? (
                <div className="flex flex-wrap items-center gap-x-2">
                  <p className="text-caption text-ink-muted" role="status">
                    {`Couldn’t refresh at ${clockTime(query.errorUpdatedAt)}. Showing the last known state${moving(op) ? "; trying again." : "."}`}
                  </p>
                  {/* Polling tries again by itself; a settled batch only
                      refreshes when asked (or on returning to the tab). */}
                  {moving(op) ? null : (
                    <Button
                      variant="ghost"
                      size="sm"
                      pending={query.isFetching}
                      onClick={() => void query.refetch()}
                    >
                      Refresh
                    </Button>
                  )}
                </div>
              ) : null}
              {/* Approving, starting, cancelling and retrying are for owners
                and admins (and stopping or retrying a review batch for the
                member who started it); say so rather than leave the page
                without actions or a reason. */}
              {role && !manager && !canControl ? (
                op.status !== "completed" && op.status !== "cancelled" ? (
                  <p className="text-caption text-ink-muted">
                    Only owners and admins can approve, start, cancel or retry a
                    bulk change.
                  </p>
                ) : null
              ) : role &&
                !manager &&
                (op.status === "previewed" || op.status === "approved") ? (
                <p className="text-caption text-ink-muted">
                  Only owners and admins can approve or start a bulk change.
                </p>
              ) : null}
            </div>
            {/* With a bar, its status carries the error beside the buttons;
                without one (the batch has moved on), it shows here. */}
            {actions ? null : <FormError>{failure}</FormError>}
            {manager && op.status === "previewed" && skipped ? (
              <Checkbox
                label={`I understand ${skipped} ${unit(skipped)} ${skipped === 1 ? "is" : "are"} skipped and will not be sent`}
                checked={acknowledged}
                onCheckedChange={(checked) => setAcknowledged(checked === true)}
              />
            ) : null}
            {actions ? (
              // One bar of actions with one primary: docked to the bottom
              // of a phone (the tab bar steps aside, and the spacer and
              // scroll padding follow its measured height, so a status that
              // wraps never hides a focused row), inline on a desk.
              // `statusRow`: the status is a sentence, too long to share a
              // row with the buttons there.
              <ActionBar
                dock
                statusRow
                label="Bulk change actions"
                safeArea={false}
                sticky={false}
                status={
                  barStatus ? (
                    <>
                      {failure ? <CircleAlertIcon aria-hidden /> : null}
                      <span data-slot="bulk-action-status">{barStatus}</span>
                    </>
                  ) : undefined
                }
                actions={actions}
              />
            ) : null}
            <AlertDialog
              open={confirmingCancel}
              onOpenChange={(open) => {
                if (!open) setConfirmingCancel(false)
              }}
            >
              <AlertDialogContent>
                <AlertDialogTitle>
                  {op.status === "previewed"
                    ? "Discard this preview?"
                    : unsent > 0
                      ? `Stop ${unsent} ${unit(unsent)} not yet sent?`
                      : "Stop this bulk change?"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {op.status === "previewed"
                    ? "Nothing has been sent to Google. To make this change later, prepare a new preview."
                    : [
                        confirmed > 0
                          ? `${confirmed} confirmed ${unit(confirmed)} ${confirmed === 1 ? "keeps its" : "keep their"} change.`
                          : null,
                        sending > 0
                          ? `${sending === 1 ? "The one" : `The ${sending}`} already sending ${sending === 1 ? "finishes" : "finish"}.`
                          : null,
                        "This can’t be undone.",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                </AlertDialogDescription>
                <AlertDialogFooter>
                  <AlertDialogClose
                    render={
                      <Button variant="ghost">
                        {op.status === "running" ? "Keep sending" : "Keep it"}
                      </Button>
                    }
                  />
                  <Button
                    variant="danger"
                    pending={mutate.isPending}
                    pendingLabel={
                      op.status === "previewed" ? "Discarding…" : "Stopping…"
                    }
                    onClick={() => {
                      setFailure(null)
                      mutate.mutate("cancel", {
                        onSettled: () => setConfirmingCancel(false),
                      })
                    }}
                  >
                    {op.status === "previewed"
                      ? "Discard preview"
                      : "Stop sending"}
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            {manager && repreview?.omitted.length ? (
              <p className="text-caption text-ink-muted" role="note">
                {`Not in the new preview: ${repreview.omitted
                  .map(
                    ({ seq, locationIds }) =>
                      `change ${seq + 1} (${OPERATION_LABEL[op.items[seq].operation]}) at ${locationIds
                        .map(
                          (id) =>
                            op.children.find((c) => c.locationId === id)
                              ?.locationName ?? id
                        )
                        .join(", ")}`
                  )
                  .join(
                    "; "
                  )}. A post draft is made again every time it is previewed, so it would reach listings that already have it. Prepare it as its own bulk change for just those listings.`}
              </p>
            ) : null}
            {/* One row per listing change, in send order: the listing (the
                whole head of the row opens it), which change, its outcome in
                words, then the exact change and its receipt below. Rows carry
                their own controls, so the row itself is not one target. */}
            <ul
              aria-label={
                multiple
                  ? "Per-listing preview and outcome of each change, in the order they are sent"
                  : "Per-listing preview and outcome"
              }
              data-slot="bulk-outcomes"
              className={cardClassName({
                className: "flex min-w-0 flex-col overflow-hidden",
              })}
            >
              {op.children.map((child) => (
                <li
                  key={child.id}
                  className="border-b border-line-subtle last:border-b-0"
                >
                  <ListRow
                    interactive={false}
                    emphasis="neutral"
                    className="px-4"
                    wrapperClassName="after:hidden"
                    title={
                      // Stretched over the row's head (the ListRow box is
                      // `relative`), so the target is the full row height
                      // while the link's name stays the listing's name.
                      <Link
                        href={`/listings/${child.locationId}`}
                        data-slot="bulk-outcome-link"
                        className={cn(
                          cardLinkClassName,
                          // Wraps, never truncates: the venue is identity.
                          "block font-semibold break-words whitespace-normal after:rounded-none"
                        )}
                      >
                        {child.locationName}
                      </Link>
                    }
                    subtitle={
                      multiple ? (
                        <span className="block whitespace-normal">
                          {child.seq + 1}. {OPERATION_LABEL[child.operation]}
                        </span>
                      ) : undefined
                    }
                    trailing={
                      <StatusPill tone={CHILD[child.status].tone}>
                        {CHILD[child.status].label}
                      </StatusPill>
                    }
                  />
                  <div className="px-4 pb-3">
                    <ChildDetail operation={op} child={child} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </QueryStates>
    </>
  )
}

const localTime = (iso: string) =>
  formatDateTime(iso, Intl.DateTimeFormat().resolvedOptions().timeZone)

/** "HH:mm" on this device's clock, for when the page last tried to refresh. */
const clockTime = (ms: number) => {
  const at = new Date(ms)
  return formatTimeOfDay({ hours: at.getHours(), minutes: at.getMinutes() })
}

/**
 * Whether the server may still move this batch on by itself: it is
 * running, or a listing in it is queued or still sending (a cancelled
 * batch's in-flight listing finishes; the runner does not reopen it).
 */
function moving(operation: Operation | undefined) {
  return Boolean(
    operation &&
    (operation.status === "running" ||
      operation.children.some(
        (child) => child.status === "queued" || child.status === "running"
      ))
  )
}

/**
 * The window that applies now: a preview can be approved for 15 minutes
 * after it read Google, and an approved change sends listings for 24 hours
 * after approval. Neither is extended; a closed window needs a new preview.
 */
function Deadline({
  operation,
  now,
  offset,
}: {
  operation: Operation
  now: number
  offset: number
}) {
  if (operation.status === "previewed") {
    const left = secondsLeft(operation.previewExpiresAt, now, offset)
    return left > 0 ? (
      <p className="text-caption text-ink-muted">
        Approve by {localTime(operation.previewExpiresAt)}; after that this
        preview expires and Google must be read again.{" "}
        {/* Not a live region: a ticking announcement every second would drown the page. */}
        <span
          className="font-medium text-ink tabular-nums"
          data-slot="bulk-preview-countdown"
        >
          {formatCountdown(left)} left
        </span>
      </p>
    ) : (
      <p className="text-caption text-ink" role="alert">
        This preview expired at {localTime(operation.previewExpiresAt)} and can
        no longer be approved. Prepare a new preview to read Google again.
      </p>
    )
  }
  if (
    operation.dispatchExpiresAt &&
    (operation.status === "approved" || operation.status === "running")
  )
    // The server reads unsent listings of a closed window as expired before
    // the sweep records it, so expired with nothing queued means closed.
    return (operation.counts.expired ?? 0) > 0 &&
      !(operation.counts.queued ?? 0) ? (
      <p className="text-caption text-ink-muted">
        The sending window closed at {localTime(operation.dispatchExpiresAt)};
        listings not sent by then were not sent.
      </p>
    ) : (
      <p className="text-caption text-ink-muted">
        Listings not sent by {localTime(operation.dispatchExpiresAt)} will not
        be sent.
      </p>
    )
  return null
}

/** The current time, ticking once a second while `active`. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

/**
 * The receipt of one listing's write (`GET /api/mutations/{id}`), read only
 * when asked for: a batch can hold 500 children, so receipts are not all
 * polled at once.
 */
function ChildReceipt({
  child,
}: {
  child: BulkChild & { mutationOperationId: string }
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-1.5">
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? "Hide receipt" : "Show receipt"}{" "}
        <span className="sr-only">for {child.locationName}</span>
      </Button>
      {open ? (
        <>
          <OperationReceiptNotice
            receiptId={child.mutationOperationId}
            fallback={
              child.status === "succeeded" ? "confirmed_applied" : "sent"
            }
          />
          <span className="text-caption break-all text-ink-muted">
            Receipt {child.mutationOperationId}
          </span>
        </>
      ) : null}
    </div>
  )
}

/**
 * One listing's detail: why it is skipped or how it ended, then the exact
 * change for that listing, current value against proposed, so the approver
 * never approves a field name without its values.
 */
function ChildDetail({
  operation,
  child,
}: {
  operation: Operation
  child: BulkChild
}) {
  // A queued change waits for the earlier changes at its listing.
  const waiting =
    child.status === "queued" &&
    !child.resultCode &&
    child.dependsOn.some((id) =>
      ["previewed", "queued", "running"].includes(
        operation.children.find((other) => other.id === id)?.status ?? ""
      )
    )
  const note =
    reason(child.skipReason ?? child.resultCode) ??
    (waiting ? "Waits for the earlier changes to this listing" : null) ??
    (child.status === "succeeded" ? "Google shows the change" : null)
  const rows = describeChildChange(child)
  const fields = child.updateMask.map(maskLabel)
  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-ui break-words text-ink-secondary">
      {note ? <span>{note}</span> : null}
      {rows.length ? (
        <ul
          aria-label={
            operation.items.length > 1
              ? `Change ${child.seq + 1} for ${child.locationName}`
              : `Change for ${child.locationName}`
          }
          className="flex flex-col gap-1"
        >
          {rows.map((row) => (
            <li key={row.label} data-slot="bulk-change-row">
              <span className="font-medium text-ink">{row.label}:</span>{" "}
              <span>{row.current}</span> <span aria-hidden>→</span>
              <span className="sr-only">changes to</span>{" "}
              <span className="font-medium text-ink">{row.proposed}</span>
            </li>
          ))}
        </ul>
      ) : !note && fields.length ? (
        <span>Changes {fields.join(", ")}</span>
      ) : null}
      {child.reviewId ? (
        <Link
          href={`/inbox?selected=${child.reviewId}`}
          className="self-start text-ink underline underline-offset-4"
        >
          Open the review{" "}
          <span className="sr-only">for {child.locationName}</span>
        </Link>
      ) : null}
      {child.mutationOperationId ? (
        <ChildReceipt
          child={{ ...child, mutationOperationId: child.mutationOperationId }}
        />
      ) : null}
    </div>
  )
}
