"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { SchedulePostSheet } from "@/components/locations/posts/schedule-post-sheet"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { QueryStates, queryStatus } from "@/components/ui/query-states"
import { StatusPill, type PillTone } from "@/components/ui/status-pill"
import { ApiClientError } from "@/lib/api/client"
import {
  actOnPostSchedule,
  approvePostSchedule,
  fetchPostSchedules,
} from "@/lib/api/publication-schedules"
import type { PublicationSchedule } from "@/lib/contracts/publication-schedules"
import {
  clockChangeCountNote,
  clockChangeNote,
  describeScheduleRule,
  slotProblemMessage,
} from "@/lib/domain/publication-schedule"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
import { useSessionRole } from "@/lib/queries/use-session"

const STATUS: Record<
  PublicationSchedule["status"],
  { label: string; tone: PillTone }
> = {
  awaiting_approval: { label: "Awaiting approval", tone: "info" },
  active: { label: "Active", tone: "ok" },
  paused: { label: "Paused", tone: "outline" },
  blocked: { label: "Needs attention", tone: "bad" },
  needs_review: { label: "Needs review", tone: "warn" },
  cancelled: { label: "Cancelled", tone: "outline" },
  completed: { label: "Completed", tone: "outline" },
}
const REASON: Record<string, string> = {
  approval_invalid:
    "The approval no longer holds (the approval policy or approver changed). Change the schedule and approve it again.",
  permission_revoked:
    "The approver or requester lost access. Change the schedule and have a current manager approve it.",
  feature_disabled:
    "Scheduled publishing was switched off for this workspace, so nothing was published. Change the schedule and approve it again once it is back.",
  recurring_disabled:
    "Repeating schedules are no longer available here, so nothing was published. Change it to a single publication, or cancel it.",
  recurring_quarantined:
    "Repeating schedules are no longer the default, so this one was stopped before it published again. Change it to a single publication, or cancel it.",
  slot_needs_new_time:
    "Its time was moved or picked automatically because of a clock change, which single publications no longer do, so it was stopped before it published. Choose a new time, or cancel it.",
  prior_occurrence_unresolved:
    "A publication was started but its result is not known yet. It is being checked and nothing is sent again; the schedule carries on once the result is known, or asks for a new time if nothing was sent.",
  prior_occurrence_unverified:
    "An earlier publication from before this update could not be confirmed either way. Check the location's posts on Google, then choose a new time or cancel it.",
  connection_changed:
    "The Google listing or connection changed after approval, so nothing was published. Change the schedule and approve it again.",
  paused_when_due:
    "The schedule was paused when its time came, so nothing was published and nothing will publish late. Choose a new time, or cancel it.",
  outside_dispatch_window:
    "It could not start within 5 minutes of its time, so nothing was published and nothing will publish late. Choose a new time, or cancel it.",
}

/**
 * A location's publication schedules and the actions each allows. With the
 * organisation's scheduling feature off (`enabled` false) existing schedules
 * stay visible and can be paused or cancelled, but nothing can be approved,
 * changed or resumed, and an empty list shows nothing at all.
 */
export function PostSchedules({
  locationId,
  timezone,
  enabled,
  recurring,
}: {
  locationId: string
  timezone: string
  enabled: boolean
  recurring: boolean
}) {
  const role = useSessionRole()
  const manager = role === "owner" || role === "admin"
  const client = useQueryClient()
  const [review, setReview] = useState<PublicationSchedule | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const query = useQuery({
    queryKey: queryKeys.postSchedules(locationId),
    queryFn: (context) =>
      fetchPostSchedules(locationId, requestOptions(context)),
  })
  const refresh = () => {
    setFailure(null)
    void client.invalidateQueries({
      queryKey: queryKeys.postSchedules(locationId),
    })
    void client.invalidateQueries({
      queryKey: queryKeys.scheduleOccurrencesAll,
    })
  }
  const failed = (error: unknown) =>
    setFailure(
      error instanceof ApiClientError
        ? error.message
        : "That change could not be saved."
    )
  const act = useMutation({
    mutationFn: (input: {
      id: string
      action: "pause" | "resume" | "cancel"
    }) => actOnPostSchedule(locationId, input.id, input.action),
    onSuccess: refresh,
    onError: failed,
  })
  const approve = useMutation({
    mutationFn: (schedule: PublicationSchedule) =>
      approvePostSchedule(
        locationId,
        schedule.id,
        schedule.payloadHash,
        schedule.revision
      ),
    onSuccess: () => {
      setReview(null)
      refresh()
    },
    onError: failed,
  })
  const schedules = query.data ?? []
  if (!enabled && schedules.length === 0) return null

  return (
    <section aria-labelledby="post-schedules" className="flex flex-col gap-3">
      <div>
        <h3 id="post-schedules" className="text-title font-semibold text-ink">
          Publication schedules
        </h3>
        <p className="text-ui text-ink-muted">
          Approved schedules publish without anyone having the page open. Any
          change needs a fresh approval.
        </p>
      </div>
      {failure && !review ? (
        <p role="alert" className="text-ui text-danger-ink">
          {failure}
        </p>
      ) : null}
      <QueryStates
        status={queryStatus(query, { isEmpty: schedules.length === 0 })}
        pendingLabel="schedules"
        error="Schedules could not be loaded"
        onRetry={() => void query.refetch()}
        empty={
          <p className="text-ui text-ink-muted">
            No schedules yet. Use Schedule on a post to plan its publication.
          </p>
        }
      >
        <ul className="flex flex-col gap-2">
          {schedules.map((schedule) => {
            const status = STATUS[schedule.status]
            const open = !["cancelled", "completed"].includes(schedule.status)
            return (
              <li
                key={schedule.id}
                className="flex min-w-0 flex-col gap-2 rounded-(--np-radius-card) border border-line bg-surface p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={status.tone}>{status.label}</StatusPill>
                  <span className="min-w-0 text-ui font-semibold break-words text-ink">
                    {schedule.template.summary.slice(0, 80) ||
                      schedule.template.topicType}
                  </span>
                </div>
                <p className="text-ui text-ink-secondary">
                  {describeScheduleRule(schedule.rule, schedule.timezone)}
                </p>
                <p className="text-caption text-ink-muted tabular-nums">
                  {Object.entries(schedule.counts)
                    .map(([key, value]) => `${value} ${key}`)
                    .join(" · ") || `${schedule.preview.total} planned`}
                  {schedule.requiresSecondApprover
                    ? " · needs a second approver"
                    : ""}
                </p>
                {schedule.statusReason && REASON[schedule.statusReason] ? (
                  <p role="status" className="text-ui text-danger-ink">
                    {REASON[schedule.statusReason]}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-1">
                  {schedule.status === "awaiting_approval" &&
                  manager &&
                  enabled ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setFailure(null)
                        setReview(schedule)
                      }}
                    >
                      Review schedule
                    </Button>
                  ) : null}
                  {schedule.status === "active" && manager ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={act.isPending}
                      onClick={() =>
                        act.mutate({ id: schedule.id, action: "pause" })
                      }
                    >
                      Pause
                    </Button>
                  ) : null}
                  {schedule.status === "paused" && manager && enabled ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={act.isPending}
                      onClick={() =>
                        act.mutate({ id: schedule.id, action: "resume" })
                      }
                    >
                      Resume
                    </Button>
                  ) : null}
                  {open && role !== "viewer" && enabled ? (
                    <SchedulePostSheet
                      locationId={locationId}
                      timezone={timezone}
                      recurring={recurring}
                      existing={schedule}
                      post={{
                        id: schedule.sourcePostId ?? schedule.id,
                        topicType: schedule.template.topicType,
                        summary: schedule.template.summary,
                      }}
                      trigger={(show) => (
                        <Button size="sm" variant="ghost" onClick={show}>
                          Change
                        </Button>
                      )}
                    />
                  ) : null}
                  {open && manager ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={act.isPending}
                      onClick={() =>
                        act.mutate({ id: schedule.id, action: "cancel" })
                      }
                    >
                      Cancel schedule
                    </Button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      </QueryStates>
      <Dialog
        open={review !== null}
        onOpenChange={(value) => !value && setReview(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve publication schedule</DialogTitle>
            <DialogDescription>
              Approval covers this exact content, location, timing and event
              dates. Each publication then runs without further approval unless
              something changes.
            </DialogDescription>
          </DialogHeader>
          {review ? (
            <DialogBody className="flex flex-col gap-3">
              <p className="text-ui break-words text-ink">
                {review.template.summary || "(No text)"}
              </p>
              <p className="text-ui text-ink-secondary">
                {describeScheduleRule(
                  review.rule,
                  review.timezone,
                  review.offsetMinutes
                )}
              </p>
              {review.preview.problem ? (
                <p role="alert" className="text-ui text-danger-ink">
                  {slotProblemMessage(review.preview.problem)} Change the
                  schedule before approving it.
                </p>
              ) : null}
              {review.eventOffsets ? (
                <p className="text-ui text-ink-secondary">
                  Event runs from {review.eventOffsets.startDays} to{" "}
                  {review.eventOffsets.endDays} days after each publication
                  date.
                </p>
              ) : null}
              <p className="text-caption text-ink-muted">
                {review.preview.total} publications
                {review.preview.adjusted
                  ? `, ${clockChangeCountNote(review.preview.adjusted)}`
                  : ""}
                {review.preview.skippedDates.length
                  ? `, skipped months ${review.preview.skippedDates.join(", ")}`
                  : ""}
                .
              </p>
              <ol className="flex flex-col gap-0.5 text-caption text-ink-secondary tabular-nums">
                {review.preview.first.map((occurrence) => (
                  <li key={occurrence.intendedAt}>
                    {occurrence.localDate} {occurrence.localTime} (
                    {review.timezone})
                    {clockChangeNote(occurrence.adjustment) ? (
                      <span className="text-warning-ink">
                        {" "}
                        · {clockChangeNote(occurrence.adjustment)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
              {!review.canApprove ? (
                <p role="status" className="text-ui text-ink">
                  A different owner or administrator must approve this schedule.
                </p>
              ) : null}
              {failure ? (
                <p role="alert" className="text-ui text-danger-ink">
                  {failure}
                </p>
              ) : null}
            </DialogBody>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReview(null)}>
              Close
            </Button>
            <Button
              disabled={!review?.canApprove || Boolean(review.preview.problem)}
              pending={approve.isPending}
              onClick={() => review && approve.mutate(review)}
            >
              Approve schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
