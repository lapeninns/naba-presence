"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Webhook } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { GroupedList, GroupedListItem } from "@/components/ui/grouped-list"
import { KpiTile } from "@/components/ui/kpi-tile"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { StatusPill } from "@/components/ui/status-pill"
import { useToastManager } from "@/components/ui/toast"
import { replayWebhookFailure } from "@/lib/api/operations-health"
import { describeActionError } from "@/lib/errors/action-errors"
import { formatNumber } from "@/lib/format"
import { queryKeys } from "@/lib/queries/keys"
import {
  useOperationsHealth,
  useWebhookFailures,
} from "@/lib/queries/use-operations-health"
import { cn } from "@/lib/utils"

/**
 * Three reconcile intervals at the documented 900s default — the same
 * threshold `/api/operations/health` applies to the reconcile tick, applied
 * here to how fresh the reconciled data itself is.
 */
const RECONCILE_STALE_AFTER_SECONDS = 2_700

function formatWhen(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return "—"
  return date.toLocaleString("en-GB")
}

function formatAge(seconds: number | null): string {
  if (seconds === null) return "—"
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`
  return `${Math.round(seconds / 86_400)} d ago`
}

/**
 * One figure. `warn` paints the value in the danger ink; the figure itself
 * still says what it is, so colour is never the only signal. A timestamp is
 * a figure too here, just a smaller one.
 */
function Metric({
  label,
  value,
  tone = "default",
  small = false,
}: {
  label: string
  value: string
  tone?: "default" | "warn" | "ok"
  small?: boolean
}) {
  return (
    <li>
      <KpiTile
        label={label}
        className="h-full"
        value={
          <span
            className={cn(
              tone === "warn" && "text-danger-ink",
              small && "text-title font-semibold tracking-normal"
            )}
          >
            {value}
          </span>
        }
      />
    </li>
  )
}

function SectionHeading({
  id,
  children,
  aside,
}: {
  id: string
  children: React.ReactNode
  aside?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id={id} className="text-title font-semibold text-ink">
        {children}
      </h2>
      {aside ? <p className="text-caption text-ink-muted">{aside}</p> : null}
    </div>
  )
}

export function OpsHealthPanel() {
  const queryClient = useQueryClient()
  const toasts = useToastManager()
  const health = useOperationsHealth()
  const failures = useWebhookFailures()

  const replay = useMutation({
    mutationFn: (eventId: string) => replayWebhookFailure(eventId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.operationsHealth }),
        queryClient.invalidateQueries({ queryKey: queryKeys.webhookFailures }),
      ])
      toasts.add({ title: "Webhook replay queued", type: "success" })
    },
    onError: (error) =>
      toasts.add({ title: describeActionError(error), type: "error" }),
  })

  if (health.isPending) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-busy="true">
        <p className="flex items-center gap-2 text-ui text-ink-muted">
          <Spinner decorative size="sm" />
          Loading operations health
        </p>
        <ul
          className="grid gap-(--np-gap-card) sm:grid-cols-2 lg:grid-cols-4"
          aria-hidden
        >
          {Array.from({ length: 4 }, (_, index) => (
            <li key={index}>
              <Skeleton className="h-24 w-full rounded-(--np-radius-card)" />
            </li>
          ))}
        </ul>
      </div>
    )
  }
  if (health.isError) {
    return (
      <Empty
        title="Could not load operations health"
        description="Refresh the page or check that you are signed in as an owner or admin."
      />
    )
  }

  const data = health.data
  const syncFailed = Number(data.sync.failed ?? 0)
  const webhookFailures = data.failedWebhookEvents + data.deadWebhookEvents
  // What the job runner itself owes. The payload's dueJobBacklog also counts
  // the metrics crons' checkpoints, which are somebody else's queue: folding
  // them in here is what made this tile warn during entirely normal
  // operation, so they get their own neutral tile below.
  const runnerBacklog =
    data.dueWebhookBacklog +
    data.dueRunnerCheckpointBacklog +
    data.duePublishBacklog
  const metricsBacklog =
    data.dueMetricsCheckpointBacklog + data.dueUnclaimedCheckpointBacklog
  const staleTicks = data.schedulerTicks.filter((tick) => tick.stale)

  return (
    <div className="flex flex-col gap-(--np-gap-section)">
      <section
        aria-labelledby="ops-system-health"
        className="flex flex-col gap-3"
      >
        <SectionHeading
          id="ops-system-health"
          aside={`Updated ${formatWhen(data.generatedAt)}`}
        >
          System health
        </SectionHeading>
        <ul className="grid gap-(--np-gap-card) sm:grid-cols-2 lg:grid-cols-3">
          <Metric
            label="Sync failed"
            value={formatNumber(syncFailed)}
            tone={syncFailed > 0 ? "warn" : "ok"}
          />
          <Metric
            label="Webhook failures"
            value={formatNumber(webhookFailures)}
            tone={webhookFailures > 0 ? "warn" : "ok"}
          />
          <Metric
            label="Due job backlog"
            value={formatNumber(runnerBacklog)}
            tone={runnerBacklog > 0 ? "warn" : "ok"}
          />
          <Metric
            label="Metrics sync backlog"
            value={formatNumber(metricsBacklog)}
          />
          <Metric
            label="Scheduler heartbeat"
            value={formatWhen(data.schedulerHeartbeatAt)}
            tone={data.schedulerHeartbeatStale ? "warn" : "ok"}
            small
          />
          <Metric
            label="Reconcile freshness"
            value={formatAge(data.reconcileStalenessSeconds)}
            tone={
              data.reconcileStalenessSeconds !== null &&
              data.reconcileStalenessSeconds > RECONCILE_STALE_AFTER_SECONDS
                ? "warn"
                : "ok"
            }
            small
          />
        </ul>
      </section>

      <section aria-labelledby="ops-ticks" className="flex flex-col gap-3">
        <SectionHeading
          id="ops-ticks"
          aside={
            staleTicks.length > 0
              ? staleTicks.length === 1
                ? "One tick has not completed recently."
                : `${formatNumber(staleTicks.length)} ticks have not completed recently.`
              : undefined
          }
        >
          Scheduled ticks
        </SectionHeading>
        {data.schedulerTicks.length === 0 ? (
          <p className="text-ui text-ink-muted">
            No scheduler activity recorded yet.
          </p>
        ) : (
          <GroupedList aria-label="Scheduler ticks">
            {data.schedulerTicks.map((tick) => (
              <GroupedListItem
                key={tick.name}
                label={<span className="font-mono text-ui">{tick.name}</span>}
                description={`Last completed ${formatWhen(tick.lastCompletedAt)}`}
                trailing={
                  tick.stale ? (
                    <StatusPill tone="at-risk">Stale</StatusPill>
                  ) : undefined
                }
              />
            ))}
          </GroupedList>
        )}
      </section>

      <section aria-labelledby="ops-sync" className="flex flex-col gap-3">
        <SectionHeading id="ops-sync">Sync and connections</SectionHeading>
        <ul className="grid gap-(--np-gap-card) sm:grid-cols-2 lg:grid-cols-3">
          <Metric
            label="Sync running"
            value={formatNumber(Number(data.sync.running ?? 0))}
          />
          <Metric
            label="Sync pending"
            value={formatNumber(Number(data.sync.pending ?? 0))}
          />
          <Metric
            label="Last successful review sync"
            value={formatWhen(
              typeof data.sync.lastSuccessfulReviewUpdate === "string"
                ? data.sync.lastSuccessfulReviewUpdate
                : null
            )}
            small
          />
          <Metric
            label="Webhook backlog"
            value={formatNumber(Number(data.webhooks.backlog ?? 0))}
          />
          <Metric
            label="Webhook failures (24h)"
            value={formatNumber(Number(data.webhooks.failures24h ?? 0))}
          />
          <Metric
            label="Provider total divergence (30d)"
            value={formatNumber(data.providerTotalDivergence30d)}
            tone={data.providerTotalDivergence30d > 0 ? "warn" : "ok"}
          />
          <Metric
            label="Grants expiring (3d)"
            value={formatNumber(data.refreshTokensExpiringSoon)}
            tone={data.refreshTokensExpiringSoon > 0 ? "warn" : "ok"}
          />
        </ul>
        {data.connections.length > 0 ? (
          <GroupedList header="Connections by status">
            {data.connections.map((row) => (
              <GroupedListItem
                key={row.status}
                label={row.status}
                trailing={formatNumber(row.count)}
              />
            ))}
          </GroupedList>
        ) : null}
      </section>

      <section aria-labelledby="ops-publishing" className="flex flex-col gap-3">
        <SectionHeading id="ops-publishing">
          Publishing (24 hours)
        </SectionHeading>
        {data.publish24h.length === 0 ? (
          <p className="text-ui text-ink-muted">No publish attempts yet.</p>
        ) : (
          <GroupedList aria-label="Publish attempts by status">
            {data.publish24h.map((row) => (
              <GroupedListItem
                key={row.status}
                label={row.status}
                tone={row.status === "failed" ? "danger" : "default"}
                trailing={formatNumber(row.count)}
              />
            ))}
          </GroupedList>
        )}
      </section>

      <section aria-labelledby="ops-webhooks" className="flex flex-col gap-3">
        <SectionHeading id="ops-webhooks">Failed webhook events</SectionHeading>
        {failures.isPending ? (
          <p
            className="flex items-center gap-2 text-ui text-ink-muted"
            role="status"
          >
            <Spinner decorative size="sm" />
            Loading failures
          </p>
        ) : failures.isError ? (
          <p className="text-ui text-danger-ink" role="alert">
            Could not load webhook failures.
          </p>
        ) : failures.data.length === 0 ? (
          <p className="text-ui text-ink-muted">
            No failed or dead webhook events.
          </p>
        ) : (
          <GroupedList aria-label="Failed webhook events">
            {failures.data.map((item) => (
              <GroupedListItem
                key={item.id}
                icon={<Webhook />}
                label={
                  <span className="flex items-center gap-2">
                    <span className="truncate">{item.eventType}</span>
                    <Badge
                      variant={
                        item.status === "dead" ? "destructive" : "warning"
                      }
                      shape="tag"
                    >
                      {item.status}
                    </Badge>
                  </span>
                }
                description={
                  <>
                    Received {formatWhen(item.receivedAt)}
                    {item.lastErrorCode ? ` · ${item.lastErrorCode}` : null}
                    {` · retries ${formatNumber(item.retryCount)}`}
                  </>
                }
                trailing={
                  item.status === "failed" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={replay.isPending}
                      onClick={() => replay.mutate(item.id)}
                    >
                      Replay
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </GroupedList>
        )}
      </section>
    </div>
  )
}
