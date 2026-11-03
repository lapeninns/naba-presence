"use client"

import { activityMaskLabels } from "@/lib/listings/activity-outcome"
import { useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { ListRow, ListRows } from "@/components/ui/list-row"
import { RelativeTime } from "@/components/ui/relative-time"
import { StatusPill } from "@/components/ui/status-pill"
import {
  decideListingChangeRequest,
  type ListingChangeRequest,
} from "@/lib/api/listing-changes"
import {
  LISTING_CHANGE_EDITOR,
  type ListingChangeEditor,
} from "@/lib/contracts/listing-changes"
import { queryKeys } from "@/lib/queries/keys"
import { useListingChangeRequests } from "@/lib/queries/use-listing-change-requests"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"

type Decision = { change: ListingChangeRequest; decision: "approve" | "reject" }

/**
 * The listing changes on this editor that are waiting for a second
 * publisher (two-person mode, lib/server/listing-changes.ts). Renders
 * nothing when none are pending; `enabled` (the location capability
 * `listingChangeApprovals`) keeps it from even asking where listing approval
 * is off.
 *
 * Each request is a list row (what it publishes, who asked and when), with
 * its explanation, what it sends and its decisions in the row's footer.
 * Another publisher gets Approve and send / Reject; the author can withdraw
 * their own request. Approving sends exactly the request shown (the decision
 * names its payload hash) and answers with the write's outcome.
 */
export function ListingChangeRequests({
  locationId,
  editor,
  enabled = true,
}: {
  locationId: string
  editor: ListingChangeEditor
  /** False where listing approval cannot apply: nothing is asked for. */
  enabled?: boolean
}) {
  const queryClient = useQueryClient()
  const requests = useListingChangeRequests(locationId, { enabled })
  const decide = useResourceMutation<
    Awaited<ReturnType<typeof decideListingChangeRequest>>,
    Decision
  >({
    mutationFn: ({ change, decision }, intent) =>
      decideListingChangeRequest(
        locationId,
        change.id,
        { decision, payloadHash: change.payloadHash },
        { intentId: intent.intentId }
      ),
    successToast: (result, { decision, change }) =>
      decision === "reject"
        ? change.isOwn
          ? "Change withdrawn. Nothing was sent to Google."
          : "Change rejected. Nothing was sent to Google."
        : { outcome: result.operation.outcome },
    // Whatever the decision did, the pending list and (after a send) the
    // location's own data have moved.
    invalidate: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.listingChangeRequests(locationId),
      })
      void queryClient.invalidateQueries({
        queryKey: ["locations", locationId],
      })
    },
    onError: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.listingChangeRequests(locationId),
      })
    },
  })

  const pending = (requests.data ?? []).filter(
    (change) => LISTING_CHANGE_EDITOR[change.kind] === editor
  )
  if (pending.length === 0) return null

  return (
    <section
      data-testid="listing-change-requests"
      aria-label="Changes waiting for approval"
      className="overflow-hidden rounded-(--np-radius-card) border border-line bg-surface"
    >
      <p role="status" className="sr-only">
        {pending.length === 1
          ? "1 change is waiting for approval."
          : `${pending.length} changes are waiting for approval.`}
      </p>
      <ListRows>
        {pending.map((change) => {
          const busy =
            decide.isPending && decide.variables?.change.id === change.id
          return (
            <ListRow
              key={change.id}
              interactive={false}
              wrap
              emphasis="neutral"
              wrapperProps={{ "data-slot": "listing-change-request" }}
              wrapperClassName="px-(--np-card-pad)"
              flush
              title={change.label}
              // The shared lifecycle pill (amber: a person acts next); the
              // one who can decide reads it as their turn.
              meta={
                <StatusPill state="awaiting_approval">
                  {change.canDecide ? "Waiting for your approval" : undefined}
                </StatusPill>
              }
              subtitle={
                <span className="text-caption text-ink-muted">
                  {change.isOwn
                    ? "You asked"
                    : `${change.author.name ?? "A publisher"} asked`}{" "}
                  · <RelativeTime iso={change.createdAt} />
                </span>
              }
              footerLayout="stack"
              footer={
                <div className="flex min-w-0 flex-col gap-2 pt-1">
                  <p className="text-ui text-ink-secondary">
                    {change.fieldMask.length > 0
                      ? `Changes: ${activityMaskLabels(change.fieldMask).join(", ")}. `
                      : ""}
                    Nothing has gone to Google yet.{" "}
                    {change.isOwn
                      ? "Another publisher needs to approve it."
                      : change.canDecide
                        ? "Approving sends exactly the values below to Google."
                        : "A publisher other than its author needs to approve it."}
                  </p>
                  {change.details.length > 0 ? (
                    // An auto label column took a long path label's full
                    // width ("Selection › Regular days › …") and left the
                    // values one letter wide: phones stack label over value,
                    // wider screens cap the label column.
                    <dl
                      data-slot="listing-change-details"
                      className="grid grid-cols-1 gap-x-3 text-ui sm:grid-cols-[fit-content(40%)_minmax(0,1fr)] sm:gap-y-1"
                      aria-label={`What this change sends: ${change.label}`}
                    >
                      {change.details.map((detail, index) => (
                        <div key={index} className="contents">
                          <dt className="min-w-0 break-words text-ink-muted">
                            {detail.label}
                          </dt>
                          <dd className="min-w-0 break-words text-ink max-sm:mb-2">
                            {detail.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  {change.canDecide || change.isOwn ? (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {change.canDecide ? (
                        <Button
                          variant="send"
                          disabled={decide.isPending}
                          aria-busy={
                            busy && decide.variables?.decision === "approve"
                          }
                          onClick={() =>
                            decide.mutate({ change, decision: "approve" })
                          }
                        >
                          Approve and send
                        </Button>
                      ) : null}
                      <Button
                        variant="secondary"
                        disabled={decide.isPending}
                        aria-busy={
                          busy && decide.variables?.decision === "reject"
                        }
                        onClick={() =>
                          decide.mutate({ change, decision: "reject" })
                        }
                      >
                        {change.isOwn ? "Withdraw" : "Reject"}
                      </Button>
                    </div>
                  ) : null}
                </div>
              }
            />
          )
        })}
      </ListRows>
    </section>
  )
}
