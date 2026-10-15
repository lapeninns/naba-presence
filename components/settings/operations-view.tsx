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
import type { OperationsHealth } from "@/lib/contracts/operations"
import { describeErrorCode } from "@/lib/errors/action-errors"
import { formatNumber } from "@/lib/format"
import { summariseScheduler } from "@/lib/operations/job-labels"
import { formatZonedTime, usableZone } from "@/lib/operations/zoned-time"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
import { useSettings } from "@/lib/queries/use-settings"
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

/** How a webhook event's status reads to an owner. */
const EVENT_STATUS_LABEL: Record<string, string> = {
  failed: "Failed",
  dead: "Stopped retrying",
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
 * An action's success is a toast; a failure is said beside the button that
 * was pressed (the row's Replay, or Retry under Notification email), not at
 * the top of the page where a phone would never see it.
 */
export function OperationsView() {
  const client = useQueryClient()
  const toast = useToastManager()
  const [retryError, setRetryError] = useState<string | null>(null)
  const [replayError, setReplayError] = useState<{
    id: string
    text: string
  } | null>(null)
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
    onSuccess: () => {
      toast.add({
        title: "Event queued for the next sync run.",
        type: "success",
      })
      refresh()
    },
    onError: (error, id) => setReplayError({ id, text: failure(error) }),
  })

  const zone = usableZone(timeZone)
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
          />
        )}
      </QueryStates>
      <SettingsSection
        variant="group"
        id="ops-webhooks"
        title="Review notification failures"
        description="Google review events that failed to process. Replaying queues one for the next sync run; it does not reply to anything."
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
              return (
                <li
                  key={item.id}
                  className="flex min-h-(--np-row-h) flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-ui text-ink-secondary">
                      {type} ·{" "}
                      {EVENT_STATUS_LABEL[item.status] ?? "Not processed"} ·
                      received {ago(item.receivedAt, undefined, zone)}
                    </span>
                    {item.lastErrorCode ? (
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
                    disabled={replay.isPending}
                    pending={replay.isPending && replay.variables === item.id}
                    onClick={() => replay.mutate(item.id)}
                    aria-label={`Replay ${type} received ${formatZonedTime(item.receivedAt, zone)}`}
                  >
                    Replay
                  </Button>
                  <p
                    aria-live="polite"
                    className="w-full text-ui text-danger-ink empty:sr-only"
                  >
                    {replayError?.id === item.id ? replayError.text : null}
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
}: {
  data: OperationsHealth
  timeZone: string | null
  retrying: boolean
  retryError: string | null
  onRetry: () => void
}) {
  const stale = data.schedulerHeartbeatStale
  const deliveries = data.notificationDeliveries
  const zone = usableZone(timeZone)
  const now = new Date()
  const summary = summariseScheduler(data.schedulerTicks, stale, now)
  return (
    <>
      <SchedulerSummaryAlert summary={summary} />
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
              "Worst reconcile age",
              data.reconcileStalenessSeconds === null
                ? "None"
                : `${Math.round(data.reconcileStalenessSeconds / 3600)} h`,
            ],
            ["Listings access lost", data.listingsAccessLost],
            ["Tokens expiring soon", data.refreshTokensExpiringSoon],
          ]}
        />
      </SettingsSection>
      <SettingsSection
        variant="group"
        id="ops-queue"
        title="Queued work"
        description="Due items by the tick that owns them."
      >
        <Figures
          rows={[
            ["All due work", data.dueJobBacklog],
            ["Work queue checkpoints", data.dueRunnerCheckpointBacklog],
            ["Metrics checkpoints", data.dueMetricsCheckpointBacklog],
            ["Review events", data.dueWebhookBacklog],
            ["Reply publishing", data.duePublishBacklog],
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
            ["Queued", deliveries.queued],
            ["Oldest queued", ago(deliveries.oldestQueuedAt, undefined, zone)],
            ...deliveries.states7d.map(
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
            disabled={retrying || deliveries.retryable === 0}
            pending={retrying}
            onClick={onRetry}
          >
            Retry{" "}
            {deliveries.retryable ? formatNumber(deliveries.retryable) : ""}{" "}
            failed {deliveries.retryable === 1 ? "email" : "emails"}
          </Button>
          <p className="text-caption text-ink-muted">
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
