"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { SchedulePostSheet } from "@/components/locations/posts/schedule-post-sheet"
import { Button } from "@/components/ui/button"
import { StatusPill } from "@/components/ui/status-pill"
import { ApiClientError } from "@/lib/api/client"
import {
  dismissLegacySchedule,
  fetchLegacySchedules,
} from "@/lib/api/publication-schedules"
import { localWallTime } from "@/lib/domain/publication-schedule"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
import { useSessionRole } from "@/lib/queries/use-session"

/**
 * Old per-post publication times from before scheduled publishing (copied
 * for review by migration 0116). Nothing ever published from them. An owner
 * or administrator schedules the post properly, which closes the review, or
 * dismisses the old time. Shown only with the scheduling feature on and
 * only to owners and administrators; nothing renders when none are open.
 */
export function LegacyPostSchedules({
  locationId,
  timezone,
}: {
  locationId: string
  timezone: string
}) {
  const role = useSessionRole()
  const manager = role === "owner" || role === "admin"
  const client = useQueryClient()
  const [failure, setFailure] = useState<string | null>(null)
  const query = useQuery({
    queryKey: queryKeys.legacyPostSchedules(locationId),
    queryFn: (context) =>
      fetchLegacySchedules(locationId, requestOptions(context)),
    enabled: manager,
    retry: false,
  })
  const dismiss = useMutation({
    mutationFn: (legacyId: string) =>
      dismissLegacySchedule(locationId, legacyId),
    onSuccess: () => {
      setFailure(null)
      void client.invalidateQueries({
        queryKey: queryKeys.legacyPostSchedules(locationId),
      })
    },
    onError: (error) =>
      setFailure(
        error instanceof ApiClientError
          ? error.message
          : "That old time could not be dismissed."
      ),
  })
  const rows = query.data ?? []
  if (!manager || rows.length === 0) return null

  return (
    <section
      aria-labelledby="legacy-post-schedules"
      className="flex flex-col gap-3"
    >
      <div>
        <h3
          id="legacy-post-schedules"
          className="text-body font-semibold text-ink"
        >
          Old post times to review
        </h3>
        <p className="text-ui text-ink-muted">
          These posts had a publication time set before scheduled publishing
          existed. Nothing was ever published from them. Schedule the post to
          publish it at a new time, or dismiss the old time.
        </p>
      </div>
      {failure ? (
        <p role="alert" className="text-ui text-danger-ink">
          {failure}
        </p>
      ) : null}
      <ul className="flex flex-col divide-y divide-line-subtle rounded-(--np-radius-card) border border-line-subtle bg-surface">
        {rows.map((row) => {
          const wall = row.scheduledPublishTime
            ? localWallTime(row.scheduledPublishTime, timezone)
            : null
          const label = row.summary.slice(0, 80) || row.topicType
          return (
            <li key={row.id} className="flex min-w-0 flex-col gap-1 px-3 py-3">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <span className="min-w-0 text-body font-semibold break-words text-ink">
                  {label}
                </span>
                <StatusPill tone="warn" className="shrink-0">
                  Needs review
                </StatusPill>
              </div>
              <p className="text-ui text-ink-secondary tabular-nums">
                {wall
                  ? `Was set for ${wall.date} ${wall.time} (${timezone})`
                  : "No time was set"}
                {row.repeats ? ", with a repeat that is no longer used" : ""}.
              </p>
              {row.alreadyScheduled ? (
                <p className="text-caption text-ink-muted">
                  This post already has a publication scheduled. Dismiss the old
                  time.
                </p>
              ) : !row.schedulable ? (
                <p className="text-caption text-ink-muted">
                  This post is already on Google or being published, so it
                  cannot be scheduled. Dismiss the old time.
                </p>
              ) : null}
              <div className="mt-1 flex flex-wrap gap-1">
                {row.schedulable ? (
                  <SchedulePostSheet
                    locationId={locationId}
                    timezone={timezone}
                    post={{
                      id: row.postId,
                      topicType: row.topicType,
                      summary: row.summary,
                    }}
                    suggested={
                      wall
                        ? { startDate: wall.date, localTime: wall.time }
                        : undefined
                    }
                    trigger={(show) => (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={show}
                        aria-label={`Schedule post: ${label}`}
                      >
                        Schedule post
                      </Button>
                    )}
                  />
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={dismiss.isPending}
                  onClick={() => dismiss.mutate(row.id)}
                  aria-label={`Dismiss old time: ${label}`}
                >
                  Dismiss
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
