"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { QueryStates, queryStatus } from "@/components/ui/query-states"
import { StatusPill } from "@/components/ui/status-pill"
import { ApiClientError } from "@/lib/api/client"
import {
  fetchOperationsHealth,
  fetchWebhookFailures,
  replayWebhookEvent,
  retryNotificationDeliveries,
} from "@/lib/api/operations"
import type { OperationsHealth } from "@/lib/contracts/operations"
import { formatNumber, formatRelativeTime } from "@/lib/format"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"

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

function ago(iso: string | null | undefined) {
  return iso ? formatRelativeTime(iso) : "None"
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded-(--np-radius-card) border border-line bg-surface p-4"
    >
      <div>
        <h2 id={id} className="text-title font-semibold text-ink">
          {title}
        </h2>
        <p className="text-caption text-ink-muted">{description}</p>
      </div>
      {children}
    </section>
  )
}

function Figures({ rows }: { rows: Array<[string, string | number]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="flex min-w-0 items-baseline justify-between gap-3 border-b border-line pb-1"
        >
          <dt className="text-ui text-ink-secondary">{label}</dt>
          <dd className="font-mono text-ui text-ink tabular-nums">
            {typeof value === "number" ? formatNumber(value) : value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * Owners' and admins' operational view: scheduler health, sync freshness,
 * queued work, unresolved Google writes and notification delivery evidence.
 * Every action here goes through a guarded server path; nothing resends a
 * write whose Google outcome is unknown.
 */
export function OperationsView() {
  const client = useQueryClient()
  const [message, setMessage] = useState<{
    tone: "ok" | "error"
    text: string
  } | null>(null)
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
  const failed = (error: unknown) =>
    setMessage({
      tone: "error",
      text:
        error instanceof ApiClientError
          ? error.message
          : "That action could not be completed.",
    })
  const retry = useMutation({
    mutationFn: retryNotificationDeliveries,
    onSuccess: (data) => {
      setMessage({
        tone: "ok",
        text: `${data.requeued} ${data.requeued === 1 ? "email" : "emails"} queued again.`,
      })
      refresh()
    },
    onError: failed,
  })
  const replay = useMutation({
    mutationFn: replayWebhookEvent,
    onSuccess: () => {
      setMessage({ tone: "ok", text: "Event queued for the next sync run." })
      refresh()
    },
    onError: failed,
  })

  return (
    <div className="flex flex-col gap-(--np-gap-section)">
      {message ? (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={
            message.tone === "error"
              ? "text-ui text-danger-ink"
              : "text-ui text-success-ink"
          }
        >
          {message.text}
        </p>
      ) : null}
      <QueryStates
        status={queryStatus(health)}
        pendingLabel="operations health"
        error="Operations health could not be loaded"
        onRetry={() => void health.refetch()}
      >
        {() => (
          <HealthSections
            data={health.data!}
            retrying={retry.isPending}
            onRetry={() => retry.mutate()}
          />
        )}
      </QueryStates>
      <Section
        id="ops-webhooks"
        title="Review notification failures"
        description="Google review events that failed to process. Replaying queues one for the next sync run; it does not reply to anything."
      >
        <QueryStates
          status={queryStatus(failures, {
            isEmpty: (failures.data?.items.length ?? 0) === 0,
          })}
          pendingLabel="failed events"
          error="Failed events could not be loaded"
          onRetry={() => void failures.refetch()}
          empty={<p className="text-ui text-ink-muted">No failed events.</p>}
        >
          <ul className="flex flex-col divide-y divide-line">
            {failures.data?.items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span className="min-w-0 text-ui text-ink-secondary">
                  {item.eventType} · {item.status} · received{" "}
                  {ago(item.receivedAt)}
                  {item.lastErrorCode ? ` · ${item.lastErrorCode}` : ""}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={replay.isPending}
                  onClick={() => replay.mutate(item.id)}
                  aria-label={`Replay ${item.eventType} received ${ago(item.receivedAt)}`}
                >
                  Replay
                </Button>
              </li>
            ))}
          </ul>
        </QueryStates>
      </Section>
    </div>
  )
}

function HealthSections({
  data,
  retrying,
  onRetry,
}: {
  data: OperationsHealth
  retrying: boolean
  onRetry: () => void
}) {
  const stale = data.schedulerHeartbeatStale
  const deliveries = data.notificationDeliveries
  return (
    <>
      <Section
        id="ops-scheduler"
        title="Scheduler"
        description="Background ticks that sync, publish and send notifications."
      >
        <p className="flex flex-wrap items-center gap-2 text-ui text-ink">
          <StatusPill tone={stale ? "bad" : "ok"}>
            {stale ? "Heartbeat stale" : "Running"}
          </StatusPill>
          <span className="text-ink-muted">
            Last heartbeat {ago(data.schedulerHeartbeatAt)}
          </span>
        </p>
        {data.schedulerTicks.length ? (
          <Figures
            rows={data.schedulerTicks.map((tick) => [
              tick.name,
              `${tick.stale ? "Stale · " : ""}${tick.lastCompletedAt ? ago(tick.lastCompletedAt) : "Never completed"}`,
            ])}
          />
        ) : null}
      </Section>
      <Section
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
              ago(data.sync.oldestOutstandingAt ?? null),
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
      </Section>
      <Section
        id="ops-queue"
        title="Queued work"
        description="Due items by the tick that owns them."
      >
        <Figures
          rows={[
            ["All due work", data.dueJobBacklog],
            ["Job runner checkpoints", data.dueRunnerCheckpointBacklog],
            ["Metrics checkpoints", data.dueMetricsCheckpointBacklog],
            ["Review events", data.dueWebhookBacklog],
            ["Reply publishing", data.duePublishBacklog],
          ]}
        />
      </Section>
      <Section
        id="ops-unresolved"
        title="Unresolved Google writes"
        description="Changes sent to Google whose result is not confirmed. They are never resent automatically: open the listing and read the saved outcome."
      >
        {data.unresolvedWrites.length ? (
          <Figures
            rows={data.unresolvedWrites.map((row) => [
              FAMILY_LABEL[row.family] ?? row.family.replaceAll("_", " "),
              `${formatNumber(row.count)} · oldest ${ago(row.oldestAt)}`,
            ])}
          />
        ) : (
          <p className="text-ui text-ink-muted">
            Every recorded write has a settled outcome.
          </p>
        )}
      </Section>
      <Section
        id="ops-email"
        title="Notification email"
        description="Accepted means the provider took the message; delivered means a mail server accepted it. Neither means it was read."
      >
        <Figures
          rows={[
            ["Queued", deliveries.queued],
            ["Oldest queued", ago(deliveries.oldestQueuedAt)],
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
        </div>
      </Section>
    </>
  )
}
