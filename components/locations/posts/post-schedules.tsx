"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import {
  formatWallDateTime,
  scheduleWhen,
  zoneName,
} from "@/components/locations/posts/schedule-dates"
import { SchedulePostSheet } from "@/components/locations/posts/schedule-post-sheet"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
import { ListRow, ListRows } from "@/components/ui/list-row"
import { QueryStates, queryStatus } from "@/components/ui/query-states"
import { StatusPill } from "@/components/ui/status-pill"
import { showToast } from "@/components/ui/toast"
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
import { POST_TOPIC_LABEL } from "@/lib/locations/post-display"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
import { useSessionRole } from "@/lib/queries/use-session"

type ScheduleAction = "pause" | "resume" | "cancel"

/** A row's occurrence counts in words: "1 planned · 2 published". */
const OCCURRENCE_LABEL: Record<string, string> = {
  scheduled: "planned",
  publishing: "publishing",
  published: "published",
  rejected: "not accepted",
  ambiguous: "being checked",
  missed: "missed",
  cancelled: "cancelled",
}

/** A schedule's name when its post has no text: "Event", not "EVENT". */
function topicName(topicType: string) {
  return (POST_TOPIC_LABEL as Record<string, string>)[topicType] ?? topicType
}

/** What the server says it did, once it has done it. */
function actedToast(action: ScheduleAction, result: PublicationSchedule) {
  if (action === "pause") return { title: "Schedule paused" }
  if (action === "cancel") return { title: "Schedule cancelled" }
  // A schedule whose text changed while it was paused resumes into review.
  return result.status === "awaiting_approval"
    ? {
        title: "Schedule resumed",
        description: "It needs approval again before it publishes.",
      }
    : { title: "Schedule resumed" }
}

/**
 * A location's publication schedules and the actions each allows. With the
 * organisation's scheduling feature off (`enabled` false) existing schedules
 * stay visible and can be paused or cancelled, but nothing can be approved,
 * changed or resumed, and an empty list shows nothing at all. A missed
 * slot is never resumed or retried; its only ways out are a new time or a
 * cancel (P08-R5). Cancelling is final, so it is confirmed first; pausing
 * can be undone by resuming, so it is one tap.
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
  const [confirmCancel, setConfirmCancel] =
    useState<PublicationSchedule | null>(null)
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
    mutationFn: (input: { id: string; action: ScheduleAction }) =>
      actOnPostSchedule(locationId, input.id, input.action),
    onSuccess: (result, input) => {
      if (input.action === "cancel") setConfirmCancel(null)
      refresh()
      showToast(actedToast(input.action, result))
    },
    onError: failed,
  })
  /** This row's action is the one waiting on the server. */
  const acting = (id: string, action: ScheduleAction) =>
    act.isPending && act.variables?.id === id && act.variables.action === action
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
      showToast({ title: "Schedule approved" })
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
          {enabled
            ? "Approved schedules publish without anyone having the page open. Any change needs a fresh approval."
            : "Scheduled publishing is switched off for this workspace, so nothing here publishes. You can still pause or cancel these schedules."}
        </p>
      </div>
      {failure && !review && !confirmCancel ? (
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
            No schedules yet. Choose Schedule publication from a post’s More
            actions menu.
          </p>
        }
      >
        <ListRows className="rounded-(--np-radius-card) border border-line-subtle bg-surface px-3">
          {schedules.map((schedule) => {
            const status = scheduleBadge(schedule)
            const reason = scheduleReasonText(schedule)
            const actions = scheduleActions(schedule, {
              manager,
              editor: role !== "viewer",
              enabled,
            })
            return (
              // A plain row (not one hit target): its actions are its own
              // buttons, drawn in the footer outside the row's body.
              <ListRow
                key={schedule.id}
                interactive={false}
                flush
                wrap
                emphasis="neutral"
                title={
                  schedule.template.summary.slice(0, 80) ||
                  topicName(schedule.template.topicType)
                }
                subtitle={
                  <span className="tabular-nums">
                    {scheduleWhen(
                      schedule.rule,
                      schedule.timezone,
                      schedule.offsetMinutes
                    )}
                  </span>
                }
                trailing={
                  <StatusPill tone={status.tone}>{status.label}</StatusPill>
                }
                footerLayout="stack"
                footer={
                  <>
                    <p className="text-caption text-ink-muted tabular-nums">
                      {describeScheduleRule(
                        schedule.rule,
                        zoneName(schedule.timezone),
                        schedule.offsetMinutes
                      )}
                      {" · "}
                      {Object.entries(schedule.counts)
                        .map(
                          ([key, value]) =>
                            `${value} ${OCCURRENCE_LABEL[key] ?? key}`
                        )
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
                    <div className="flex flex-wrap gap-1">
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
                          pending={acting(schedule.id, "pause")}
                          pendingLabel="Pausing…"
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
                          pending={acting(schedule.id, "resume")}
                          pendingLabel="Resuming…"
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
                          pending={acting(schedule.id, "cancel")}
                          pendingLabel="Cancelling…"
                          onClick={() => {
                            setFailure(null)
                            setConfirmCancel(schedule)
                          }}
                        >
                          Cancel schedule
                        </Button>
                      ) : null}
                    </div>
                  </>
                }
              />
            )
          })}
        </ListRows>
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
                  zoneName(review.timezone),
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
                    {formatWallDateTime(
                      occurrence.localDate,
                      occurrence.localTime
                    )}{" "}
                    {zoneName(review.timezone)}
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
      <AlertDialog
        open={confirmCancel !== null}
        onOpenChange={(value) => {
          if (value || act.isPending) return
          setConfirmCancel(null)
          setFailure(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Cancel this schedule?</AlertDialogTitle>
          <AlertDialogDescription>
            Nothing more publishes from it. A cancelled schedule can’t be
            restarted; schedule the post again to publish it later.
          </AlertDialogDescription>
          {failure ? (
            <p role="alert" className="text-ui text-danger-ink">
              {failure}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogClose
              disabled={act.isPending}
              render={<Button variant="ghost">Keep schedule</Button>}
            />
            <Button
              variant="danger"
              pending={
                confirmCancel !== null && acting(confirmCancel.id, "cancel")
              }
              pendingLabel="Cancelling…"
              onClick={() => {
                if (!confirmCancel) return
                setFailure(null)
                act.mutate({ id: confirmCancel.id, action: "cancel" })
              }}
            >
              Cancel schedule
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
