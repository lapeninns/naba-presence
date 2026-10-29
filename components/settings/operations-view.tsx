"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { SupportDetails } from "@/components/editors/support-details"
import {
  ScheduledJobsDisclosure,
  SchedulerSummaryAlert,
} from "@/components/settings/scheduled-jobs-panel"
import {
  SettingsFacts,
  SettingsSection,
} from "@/components/settings/settings-section"
import { Button } from "@/components/ui/button"
import { ListRow, ListRows } from "@/components/ui/list-row"
import { QueryStates, queryStatus } from "@/components/ui/query-states"
import { RelativeTime } from "@/components/ui/relative-time"
import { StatusPill } from "@/components/ui/status-pill"
import { useToastManager } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"
import {
  fetchOperationsHealth,
  fetchWebhookFailures,
  replayWebhookEvent,
  retryNotificationDeliveries,
} from "@/lib/api/operations"
import type {
  OperationsHealth,
  WebhookFailure,
} from "@/lib/contracts/operations"
import { describeErrorCode } from "@/lib/errors/action-errors"
import { formatNumber } from "@/lib/format"
import { formatSpan, summariseScheduler } from "@/lib/operations/job-labels"
import { formatZonedTime, usableZone } from "@/lib/operations/zoned-time"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
import { useSettings } from "@/lib/queries/use-settings"
import { cn } from "@/lib/utils"
import { useNow } from "@/lib/time/server-now"
import { describeNotificationType } from "@/lib/settings/gating"

const FAMILY_LABEL: Record<string, string> = {
  links: "Action links",
  hours: "Opening hours",
  profile: "Business profile",
  menus: "Food menus",
  media: "Photos",
  posts: "Posts",
  reviews: "Review replies",
  management: "Profile management",
}
/** Email states, in this order on the page: good outcomes first, then bad. */
const STATE_LABEL: Record<string, string> = {
  queued: "Queued",
  accepted: "Accepted by provider",
  delivery_delayed: "Delivery delayed",
  delivered: "Delivered to mail server",
  bounced: "Bounced",
  complained: "Marked as spam",
  failed: "Failed",
  suppressed: "Not sent (suppressed)",
  unknown: "Outcome unknown",
}

const STATE_ORDER = Object.keys(STATE_LABEL)
const stateRank = (state: string) => {
  const at = STATE_ORDER.indexOf(state)
  return at === -1 ? STATE_ORDER.length : at
}

/**
 * "Under 1 hour" below an hour (never "0 h"), otherwise whole hours as
 * words ("3 hours", "1 day").
 */
function hoursSince(seconds: number) {
  return seconds < 3600
    ? "Under 1 hour"
    : formatSpan(Math.round(seconds / 3600) * 3600)
}

/**
 * The most failed events the list carries: `loadWebhookFailures`
 * (lib/server/operations-health.ts) returns the newest 100, so a full list
 * may stand for more.
 */
const WEBHOOK_FAILURES_LIMIT = 100

/**
 * A replayed event the runner has tried again and failed: the replay reset
 * its retry count and error (app/api/webhooks/google/pubsub/replay), and
 * only a later failure sets them again (lib/server/jobs.ts) or
 * dead-letters it.
 */
function failedSinceReplay(item: WebhookFailure): boolean {
  return (
    item.retryCount > 0 || item.lastErrorCode !== null || item.status === "dead"
  )
}

/** How a webhook event's status reads to an owner. */
const EVENT_STATUS_LABEL: Record<string, string> = {
  failed: "Failed",
  dead: "Stopped retrying",
}

/**
 * A failed event the runner will try again by itself (it is dead-lettered,
 * "Stopped retrying", once its budget is spent) says so, with the next try
 * the server scheduled when it is still ahead and the zone is known.
 */
function eventStatus(
  item: WebhookFailure,
  zone: string | undefined,
  now: Date
): string {
  if (item.status === "failed" && item.nextAttemptAt) {
    const next = new Date(item.nextAttemptAt)
    return zone && next.getTime() > now.getTime()
      ? `Failed · retrying automatically, next try ${formatZonedTime(item.nextAttemptAt, zone, now)}`
      : "Failed · retrying automatically"
  }
  return EVENT_STATUS_LABEL[item.status] ?? "Not processed"
}

/**
 * `timeZone`: the organisation's zone, for the exact time on hover; no hover
 * time until it is known.
 */
function ago(
  iso: string | null | undefined,
  prefix?: string,
  timeZone?: string
) {
  return iso ? (
    <RelativeTime iso={iso} prefix={prefix} timeZone={timeZone ?? null} />
  ) : (
    "None"
  )
}

/** Label/value figures, numbers formatted, values in tabular mono. */
function Figures({
  rows,
}: {
  rows: Array<[string, React.ReactNode | number]>
}) {
  return (
    <SettingsFacts
      columns={3}
      numeric
      facts={rows.map(
        ([label, value]) =>
          [
            label,
            typeof value === "number" ? formatNumber(value) : value,
          ] as const
      )}
    />
  )
}

/**
 * Owners' and admins' operational view: scheduler health, sync freshness,
 * queued work, unresolved Google writes and notification delivery evidence.
 * Every action here goes through a guarded server path; nothing resends a
 * write whose Google outcome is unknown.
 *
 * Retrying email says its success in a toast; a replay says it on its own
 * row, once. A failure is said beside the button that was pressed (the
 * row's Replay, or Retry under Notification email), not at the top of the
 * page where a phone would never see it.
 */
export function OperationsView() {
  const client = useQueryClient()
  const toast = useToastManager()
  const [retryError, setRetryError] = useState<string | null>(null)
  const [replayError, setReplayError] = useState<{
    id: string
    text: string
  } | null>(null)
  // Events the server accepted for replay (202) in this visit, with when. The
  // row stays listed as "failed" until the next sync run picks it up, so it
  // says so and its button rests -- until a list fetched after the replay
  // shows it failed again. Display only; the server still guards a repeat.
  const [replayed, setReplayed] = useState<ReadonlyMap<string, number>>(
    () => new Map()
  )
  // The organisation's default time zone, for every clock time on the page.
  const timeZone = useSettings().data?.defaultTimezone ?? null
  const health = useQuery({
    queryKey: queryKeys.operationsHealth,
    queryFn: (context) => fetchOperationsHealth(requestOptions(context)),
    refetchInterval: 60_000,
  })
  const failures = useQuery({
    queryKey: queryKeys.webhookFailures,
    queryFn: (context) => fetchWebhookFailures(requestOptions(context)),
  })
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["operations"] })
  }
  const failure = (error: unknown) =>
    error instanceof ApiClientError
      ? error.message
      : "That action could not be completed."
  const retry = useMutation({
    mutationFn: retryNotificationDeliveries,
    onMutate: () => setRetryError(null),
    onSuccess: (data) => {
      toast.add({
        title: `${data.requeued} ${data.requeued === 1 ? "email" : "emails"} queued again.`,
        type: "success",
      })
      refresh()
    },
    onError: (error) => setRetryError(failure(error)),
  })
  const replay = useMutation({
    mutationFn: replayWebhookEvent,
    onMutate: () => setReplayError(null),
    // No toast: the row's own polite region says "Queued for the next sync
    // run.", and saying it twice reads it twice.
    onSuccess: (_, id) => {
      setReplayed((current) => new Map(current).set(id, Date.now()))
      refresh()
    },
    onError: (error, id) => setReplayError({ id, text: failure(error) }),
  })

  const zone = usableZone(timeZone)
  // The server's clock while hydrating (lib/time/server-now.tsx), so a label
  // that falls back to a relative age reads the same on both sides.
  const now = new Date(useNow())
  return (
    <div className="flex flex-col gap-(--np-gap-section)">
      <QueryStates
        status={queryStatus(health)}
        pendingLabel="Loading operations health"
        error="Operations health could not be loaded"
        onRetry={() => void health.refetch()}
      >
        {() => (
          <HealthSections
            data={health.data!}
            timeZone={timeZone}
            retrying={retry.isPending}
            retryError={retryError}
            onRetry={() => retry.mutate()}
            failedEvents={failures.data?.items.length ?? 0}
            failedEventsCapped={
              (failures.data?.items.length ?? 0) >= WEBHOOK_FAILURES_LIMIT
            }
          />
        )}
      </QueryStates>
      <SettingsSection
        variant="group"
        id="ops-webhooks"
        title="Review notification failures"
        description="Google review events that failed to process. Failed events are retried automatically; replay one that has stopped retrying, or to run it sooner. Replaying does not reply to anything."
      >
        <QueryStates
          status={queryStatus(failures, {
            isEmpty: (failures.data?.items.length ?? 0) === 0,
          })}
          pendingLabel="Loading failed events"
          error="Failed events could not be loaded"
          onRetry={() => void failures.refetch()}
          empty={<p className="text-body text-ink-muted">No failed events.</p>}
        >
          <ul className="flex flex-col divide-y divide-line">
            {failures.data?.items.map((item) => {
              const type = describeNotificationType(item.eventType)
              const replayedAt = replayed.get(item.id)
              // invalidateQueries cancels a fetch already in flight, so a
              // list updated after the replay was read after it.
              const queued =
                replayedAt !== undefined &&
                !(
                  failures.dataUpdatedAt > replayedAt && failedSinceReplay(item)
                )
              const error = replayError?.id === item.id ? replayError : null
              const outcomeId = `ops-replay-${item.id}`
              return (
                <li
                  key={item.id}
                  className="flex min-h-(--np-row-h) flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-ui text-ink-secondary">
                      {type} ·{" "}
                      {queued ? null : (
                        <>
                          {eventStatus(item, zone, now)}
                          {" · "}
                        </>
                      )}
                      received {ago(item.receivedAt, undefined, zone)}
                    </span>
                    {item.lastErrorCode && !queued ? (
                      <span className="text-caption text-ink-muted">
                        {describeErrorCode(item.lastErrorCode)}
                      </span>
                    ) : null}
                    <SupportDetails
                      items={[item.eventType, item.status, item.lastErrorCode]}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={replay.isPending || queued}
                    pending={replay.isPending && replay.variables === item.id}
                    onClick={() => replay.mutate(item.id)}
                    aria-label={`Replay ${type} received ${formatZonedTime(item.receivedAt, zone, now)}`}
                    aria-describedby={queued ? outcomeId : undefined}
                  >
                    Replay
                  </Button>
                  {/* One polite region per row: the press's failure, or,
                      after the server accepted it, what happens next. */}
                  <p
                    id={outcomeId}
                    aria-live="polite"
                    className={cn(
                      "w-full empty:sr-only",
                      error
                        ? "text-ui text-danger-ink"
                        : "text-caption text-ink-secondary"
                    )}
                  >
                    {error
                      ? error.text
                      : queued
                        ? "Queued for the next sync run."
                        : null}
                  </p>
                </li>
              )
            })}
          </ul>
        </QueryStates>
      </SettingsSection>
    </div>
  )
}

function HealthSections({
  data,
  timeZone,
  retrying,
  retryError,
  onRetry,
  failedEvents,
  failedEventsCapped,
}: {
  data: OperationsHealth
  timeZone: string | null
  retrying: boolean
  retryError: string | null
  onRetry: () => void
  /** Failed review events listed below (0 while they load). */
  failedEvents: number
  /** The list is at the server's limit, so there may be more. */
  failedEventsCapped: boolean
}) {
  const stale = data.schedulerHeartbeatStale
  const deliveries = data.notificationDeliveries
  const zone = usableZone(timeZone)
  // Overdue is decided during render, and the page is now server-rendered
  // (SET-22): the server's clock while hydrating, so a device clock that is
  // off can't flip "On schedule" to "Overdue" mid-hydration (#418).
  const now = new Date(useNow())
  const summary = summariseScheduler(data.schedulerTicks, stale, now)
  const unresolved = data.unresolvedWrites.reduce(
    (total, row) => total + row.count,
    0
  )
  // Everything below the summary that someone can act on, each a link to
  // where it is shown or fixed; a row only when its count is above 0.
  const attention = (
    [
      ["Syncs that failed", data.sync.failed ?? 0, "#ops-sync", null, null],
      // The login works but no longer manages these listings
      // (recordListingAccessLoss): reconnecting can't fix it, so this
      // points at the listings, as profile-unreachable.tsx words it.
      [
        "Listings Google no longer lets us reach",
        data.listingsAccessLost,
        "/listings?health=attention",
        "The Google login works, but it no longer manages these listings. Someone at the business has to restore manager access on Google.",
        null,
      ],
      [
        "Google sign-ins expiring soon",
        data.refreshTokensExpiringSoon,
        "/settings/connections",
        null,
        null,
      ],
      [
        "Google changes waiting for a confirmed result",
        unresolved,
        "#ops-unresolved",
        null,
        null,
      ],
      [
        "Failed emails you can retry",
        deliveries.retryable,
        "#ops-email",
        null,
        null,
      ],
      [
        "Review events that failed to process",
        failedEvents,
        "#ops-webhooks",
        null,
        failedEventsCapped ? `${formatNumber(failedEvents)}+` : null,
      ],
    ] as const
  ).filter(([, count]) => count > 0)
  const states = [...deliveries.states7d].sort(
    (a, b) => stateRank(a.state) - stateRank(b.state)
  )
  const nothingToRetry = deliveries.retryable === 0
  return (
    <>
      <SchedulerSummaryAlert summary={summary} />
      {attention.length ? (
        <SettingsSection
          variant="group"
          id="ops-attention"
          title="Needs attention"
        >
          <ListRows aria-label="Needs attention">
            {attention.map(([label, count, href, subtitle, shown]) => (
              <ListRow
                key={label}
                href={href}
                flush
                wrap
                emphasis="neutral"
                title={label}
                subtitle={subtitle ?? undefined}
                meta={shown ?? formatNumber(count)}
              />
            ))}
          </ListRows>
        </SettingsSection>
      ) : null}
      <SettingsSection
        variant="group"
        id="ops-scheduler"
        title="Scheduler"
        description="Background jobs that sync, publish and send notifications."
      >
        <p className="flex flex-wrap items-center gap-2 text-ui text-ink">
          <StatusPill tone={stale ? "bad" : "ok"}>
            {stale ? "Not reporting" : "Running"}
          </StatusPill>
          <span className="text-ink-muted">
            Last check-in {ago(data.schedulerHeartbeatAt, undefined, zone)}
          </span>
        </p>
        {data.schedulerTicks.length ? (
          <ScheduledJobsDisclosure
            ticks={data.schedulerTicks}
            summary={summary}
            timeZone={timeZone}
            now={now}
          />
        ) : null}
      </SettingsSection>
      <SettingsSection
        variant="group"
        id="ops-sync"
        title="Sync freshness"
        description="How current our copy of Google data is."
      >
        <Figures
          rows={[
            ["Syncs pending", data.sync.pending ?? 0],
            ["Syncs failed", data.sync.failed ?? 0],
            [
              "Oldest outstanding sync",
              ago(data.sync.oldestOutstandingAt ?? null, undefined, zone),
            ],
            [
              "Longest since a review check",
              data.reconcileStalenessSeconds === null
                ? "None"
                : hoursSince(data.reconcileStalenessSeconds),
            ],
            ["Listings we can no longer reach", data.listingsAccessLost],
            ["Google sign-ins expiring soon", data.refreshTokensExpiringSoon],
          ]}
        />
      </SettingsSection>
      <SettingsSection
        variant="group"
        id="ops-queue"
        title="Queued work"
        description="Work that is due now, by the job that handles it."
      >
        <Figures
          rows={[
            ["Total waiting", data.dueJobBacklog],
            ["Data refreshes waiting", data.dueRunnerCheckpointBacklog],
            ["Performance refreshes waiting", data.dueMetricsCheckpointBacklog],
            ["Review updates waiting", data.dueWebhookBacklog],
            ["Replies waiting to publish", data.duePublishBacklog],
          ]}
        />
      </SettingsSection>
      <SettingsSection
        variant="group"
        id="ops-unresolved"
        title="Unresolved Google writes"
        description="Changes sent to Google whose result is not confirmed. They are never resent automatically: open the listing and read the saved outcome."
      >
        {data.unresolvedWrites.length ? (
          <Figures
            rows={data.unresolvedWrites.map((row) => [
              FAMILY_LABEL[row.family] ?? row.family.replaceAll("_", " "),
              <>
                {formatNumber(row.count)} · oldest{" "}
                {ago(row.oldestAt, undefined, zone)}
              </>,
            ])}
          />
        ) : (
          <p className="text-body text-ink-muted">
            Every recorded write has a settled outcome.
          </p>
        )}
      </SettingsSection>
      <SettingsSection
        variant="group"
        id="ops-email"
        title="Notification email"
        description="Accepted means the provider took the message; delivered means a mail server accepted it. Neither means it was read."
      >
        <Figures
          rows={[
            ["Waiting to send now", deliveries.queued],
            ["Oldest waiting", ago(deliveries.oldestQueuedAt, undefined, zone)],
            ...states.map(
              (row) =>
                [
                  `${STATE_LABEL[row.state] ?? row.state} (7 days)`,
                  row.count,
                ] as [string, number]
            ),
          ]}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={retrying || nothingToRetry}
            pending={retrying}
            onClick={onRetry}
            aria-describedby="ops-retry-reason"
          >
            Retry{" "}
            {deliveries.retryable ? formatNumber(deliveries.retryable) : ""}{" "}
            failed {deliveries.retryable === 1 ? "email" : "emails"}
          </Button>
          <p id="ops-retry-reason" className="text-caption text-ink-muted">
            {nothingToRetry ? "No failed emails to retry. " : null}
            Unknown outcomes older than 23 hours are not retried, to avoid a
            duplicate.
          </p>
          <p
            aria-live="polite"
            className="w-full text-ui text-danger-ink empty:sr-only"
          >
            {retryError}
          </p>
        </div>
      </SettingsSection>
    </>
  )
}
