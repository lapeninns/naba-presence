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
}
const REASON: Record<string, string> = {
  already_applied: "Already shows this change",
  publish_not_allowed: "You can’t publish to this listing",
  attribute_not_offered: "Its category doesn’t offer this attribute",
  attribute_value_not_supported: "Google doesn’t accept this value here",
  hours_type_not_supported: "Google doesn’t offer this hours type here",
  action_type_not_supported: "Google doesn’t offer this action type here",
  link_not_found: "No matching link to remove",
  provider_owned: "The link belongs to a booking provider",
  google_baseline_changed:
    "Changed on Google after the preview; prepare a new preview",
  permission_revoked: "Approval no longer valid: access changed",
  approval_policy_changed: "The approval policy changed",
  execution_interrupted:
    "Interrupted; retry reads Google before anything is sent again",
  response_ambiguous: "Google’s response was lost; retry reads Google first",
  readback_mismatch: "Google doesn’t show the change yet",
  readback_failed: "Google couldn’t be read to confirm",
  google_rate_limited: "Waiting for Google quota",
  publishing_paused: "Publishing is paused",
}
const reason = (code: string | null) =>
  code
    ? (REASON[code] ??
      (code.startsWith("provider_rejected")
        ? "Google rejected the change"
        : code.replaceAll("_", " ")))
    : null
const OPERATION_LABEL: Record<Operation["operation"], string> = {
  regular_hours: "Opening hours",
  special_hours: "Special hours",
  more_hours: "Service hours",
  attributes: "Attributes",
  place_action: "Action link",
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
            ? `${OPERATION_LABEL[op.operation]} across ${op.children.length} ${op.children.length === 1 ? "listing" : "listings"}`
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
                          : "This preview expired."}{" "}
              {Object.entries(op.counts)
                .map(
                  ([status, count]) =>
                    `${count} ${CHILD[status as BulkChild["status"]]?.label.toLowerCase() ?? status}`
                )
                .join(" · ")}
            </p>
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
                        label={`I understand ${skipped} ${skipped === 1 ? "listing is" : "listings are"} skipped and will not change`}
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
                    Retry {retryable} unsettled{" "}
                    {retryable === 1 ? "listing" : "listings"}
                  </Button>
                ) : null}
              </div>
            ) : null}
            <Table surface responsive>
              <caption className="sr-only">
                Per-listing preview and outcome
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
  const note =
    reason(child.skipReason ?? child.resultCode) ??
    (child.status === "succeeded" ? "Google shows the change" : null)
  const rows = describeChildChange(operation.operation, operation.input, child)
  const fields = child.updateMask.map(maskLabel)
  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-ui break-words text-ink-secondary">
      {note ? <span>{note}</span> : null}
      {rows.length ? (
        <ul
          aria-label={`Change for ${child.locationName}`}
          className="flex flex-col gap-1"
        >
          {rows.map((row) => (
            <li key={row.label} data-slot="bulk-change-row">
              <span className="font-medium text-ink">{row.label}:</span>{" "}
              <span>{row.current}</span>{" "}
              <span aria-hidden>→</span>
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
