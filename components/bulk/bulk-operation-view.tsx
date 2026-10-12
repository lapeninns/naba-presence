"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"

import { PageHeader } from "@/components/app-shell/page-frame"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { QueryStates, queryStatus } from "@/components/ui/query-states"
import { StatusPill, type PillTone } from "@/components/ui/status-pill"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ApiClientError } from "@/lib/api/client"
import {
  approveBulkChange,
  cancelBulkChange,
  fetchBulkChange,
  retryBulkChange,
  startBulkChange,
} from "@/lib/api/bulk-listings"
import type {
  BulkChild,
  BulkOperationView as Operation,
} from "@/lib/contracts/bulk-listings"
import { formatDateTime } from "@/lib/format"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
import { useSessionRole } from "@/lib/queries/use-session"

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
  // Review replies (P09-R8).
  submitted_for_approval: "Submitted for approval; nothing sent to Google yet",
  approval_withdrawn:
    "Not sent: the approval was withdrawn or replaced after this batch started",
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
  const manager = role === "owner" || role === "admin"
  const client = useQueryClient()
  const [acknowledged, setAcknowledged] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const query = useQuery({
    queryKey: queryKeys.bulkChange(operationId),
    queryFn: (context) => fetchBulkChange(operationId, requestOptions(context)),
    refetchInterval: (state) =>
      state.state.data?.status === "running" ? 5_000 : false,
  })
  const mutate = useMutation({
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
    onSuccess: (data) => {
      setFailure(null)
      client.setQueryData(queryKeys.bulkChange(operationId), data)
      void client.invalidateQueries({ queryKey: queryKeys.bulkChanges })
    },
    onError: (error) =>
      setFailure(
        error instanceof ApiClientError
          ? error.message
          : "That action could not be completed."
      ),
  })
  const op = query.data
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
      <QueryStates
        status={queryStatus(query)}
        pendingLabel="bulk change"
        error="The bulk change could not be loaded"
        onRetry={() => void query.refetch()}
      >
        {op ? (
          <div className="flex flex-col gap-4">
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
            <Deadline operation={op} />
            {failure ? (
              <p role="alert" className="text-ui text-danger-ink">
                {failure}
              </p>
            ) : null}
            {manager ? (
              <div className="flex flex-wrap items-center gap-3">
                {op.status === "previewed" ? (
                  <>
                    {skipped ? (
                      <Checkbox
                        label={`I understand ${skipped} ${unit(skipped)} ${skipped === 1 ? "is" : "are"} skipped and will not be sent`}
                        checked={acknowledged}
                        onCheckedChange={(checked) =>
                          setAcknowledged(checked === true)
                        }
                      />
                    ) : null}
                    <Button
                      disabled={
                        !op.canApprove || (skipped > 0 && !acknowledged)
                      }
                      pending={mutate.isPending}
                      onClick={() => mutate.mutate("approve")}
                    >
                      Approve this exact change
                    </Button>
                    {!op.canApprove ? (
                      <span className="text-caption text-ink-muted">
                        A different owner or administrator must approve.
                      </span>
                    ) : null}
                  </>
                ) : null}
                {op.status === "approved" ? (
                  <Button
                    pending={mutate.isPending}
                    onClick={() => mutate.mutate("start")}
                  >
                    Start bulk change
                  </Button>
                ) : null}
                {op.status === "running" ||
                op.status === "approved" ||
                op.status === "previewed" ? (
                  <Button
                    variant="secondary"
                    disabled={mutate.isPending}
                    onClick={() => mutate.mutate("cancel")}
                  >
                    Cancel remaining listings
                  </Button>
                ) : null}
                {retryable &&
                ["running", "completed_with_failures"].includes(op.status) ? (
                  <Button
                    variant="secondary"
                    disabled={mutate.isPending}
                    onClick={() => mutate.mutate("retry")}
                  >
                    Retry {retryable} unsettled {unit(retryable)}
                  </Button>
                ) : null}
              </div>
            ) : null}
            <Table surface responsive>
              <caption className="sr-only">
                {multiple
                  ? "Per-listing preview and outcome of each change, in the order they are sent"
                  : "Per-listing preview and outcome"}
              </caption>
              <TableHeader>
                <TableRow>
                  <TableHead>Listing</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {op.children.map((child) => (
                  <TableRow key={child.id}>
                    <TableCell label="Listing">
                      <Link
                        href={`/listings/${child.locationId}`}
                        className="font-semibold break-words text-ink underline-offset-4 hover:underline"
                      >
                        {child.locationName}
                      </Link>
                      {multiple ? (
                        <span className="block text-caption text-ink-muted">
                          {child.seq + 1}. {OPERATION_LABEL[child.operation]}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell label="Outcome">
                      <StatusPill tone={CHILD[child.status].tone}>
                        {CHILD[child.status].label}
                      </StatusPill>
                    </TableCell>
                    <TableCell label="Detail" span>
                      <ChildDetail operation={op} child={child} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </QueryStates>
    </>
  )
}

const localTime = (iso: string) =>
  formatDateTime(iso, Intl.DateTimeFormat().resolvedOptions().timeZone)

/**
 * The window that applies now: a preview can be approved for 15 minutes
 * after it read Google, and an approved change sends listings for 24 hours
 * after approval. Neither is extended; a closed window needs a new preview.
 */
function Deadline({ operation }: { operation: Operation }) {
  if (operation.status === "previewed")
    return (
      <p className="text-caption text-ink-muted">
        Approve by {localTime(operation.previewExpiresAt)}; after that this
        preview expires and Google must be read again.
      </p>
    )
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
    </div>
  )
}
