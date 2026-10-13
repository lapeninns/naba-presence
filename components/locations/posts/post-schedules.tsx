"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { scheduleWhen } from "@/components/locations/posts/schedule-dates"
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
import { StatusPill } from "@/components/ui/status-pill"
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
import {
  scheduleActions,
  scheduleBadge,
  scheduleReasonText,
} from "@/lib/locations/schedule-display"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
import { useSessionRole } from "@/lib/queries/use-session"

/**
 * A location's publication schedules and the actions each allows. With the
 * organisation's scheduling feature off (`enabled` false) existing schedules
 * stay visible and can be paused or cancelled, but nothing can be approved,
 * changed or resumed, and an empty list shows nothing at all. A missed
 * slot is never resumed or retried; its only ways out are a new time or a
 * cancel (P08-R5).
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
        <h3 id="post-schedules" className="text-body font-semibold text-ink">
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
        <ul className="flex flex-col divide-y divide-line-subtle rounded-(--np-radius-card) border border-line-subtle bg-surface">
          {schedules.map((schedule) => {
            const status = scheduleBadge(schedule)
            const reason = scheduleReasonText(schedule)
            const actions = scheduleActions(schedule, {
              manager,
              editor: role !== "viewer",
              enabled,
            })
            return (
              <li
                key={schedule.id}
                className="flex min-w-0 flex-col gap-1 px-3 py-3"
              >
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <span className="min-w-0 text-body font-semibold break-words text-ink">
                    {schedule.template.summary.slice(0, 80) ||
                      schedule.template.topicType}
                  </span>
                  <StatusPill tone={status.tone} className="shrink-0">
                    {status.label}
                  </StatusPill>
                </div>
                <p className="text-ui text-ink-secondary tabular-nums">
                  {scheduleWhen(
                    schedule.rule,
                    schedule.timezone,
                    schedule.offsetMinutes
                  )}
                </p>
                <p className="text-caption text-ink-muted tabular-nums">
                  {describeScheduleRule(
                    schedule.rule,
                    schedule.timezone,
                    schedule.offsetMinutes
                  )}
                  {" · "}
                  {Object.entries(schedule.counts)
                    .map(([key, value]) => `${value} ${key}`)
                    .join(" · ") || `${schedule.preview.total} planned`}
                  {schedule.requiresSecondApprover
                    ? " · needs a second approver"
                    : ""}
                </p>
                {reason ? (
                  <p role="status" className="text-ui text-danger-ink">
                    {reason}
                  </p>
                ) : null}
                <div className="mt-1 flex flex-wrap gap-1">
                  {actions.review ? (
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
                  {actions.pause ? (
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
                  {actions.resume ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={act.isPending}
                      onClick={() =>
                        act.mutate({ id: schedule.id, action: "resume" })
                      }
                    >
                      {actions.resume}
                    </Button>
                  ) : null}
                  {actions.change ? (
                    <SchedulePostSheet
                      locationId={locationId}
                      timezone={timezone}
                      recurring={recurring}
                      existing={schedule}
                      newTime={actions.change === "Choose a new time"}
                      post={{
                        id: schedule.sourcePostId ?? schedule.id,
                        topicType: schedule.template.topicType,
                        summary: schedule.template.summary,
                      }}
                      trigger={(show) => (
                        <Button
                          size="sm"
                          variant={
                            actions.change === "Choose a new time"
                              ? "secondary"
                              : "ghost"
                          }
                          onClick={show}
                        >
                          {actions.change}
                        </Button>
                      )}
                    />
                  ) : null}
                  {actions.cancel ? (
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
