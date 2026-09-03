"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { useToastManager } from "@/components/ui/toast"
import { replayWebhookFailure } from "@/lib/api/operations-health"
import { describeActionError } from "@/lib/errors/action-errors"
import { formatNumber } from "@/lib/format"
import { queryKeys } from "@/lib/queries/keys"
import {
  useOperationsHealth,
  useWebhookFailures,
} from "@/lib/queries/use-operations-health"

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

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string
  value: string
  tone?: "default" | "warn" | "ok"
}) {
  return (
    <li className="flex flex-col gap-1 rounded-(--nr-radius-card) border border-border p-3">
      <span className="text-caption text-muted-foreground">{label}</span>
      <span
        className={
          tone === "warn"
            ? "text-title font-semibold text-destructive"
            : tone === "ok"
              ? "text-title font-semibold text-foreground"
              : "text-title font-semibold"
        }
      >
        {value}
      </span>
    </li>
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
    return <p className="text-ui text-muted-foreground">Loading operations health…</p>
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
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-title font-semibold">System health</h2>
          <p className="text-caption text-muted-foreground">
            Updated {formatWhen(data.generatedAt)}
          </p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          />
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold">Scheduled ticks</h2>
        {data.schedulerTicks.length === 0 ? (
          <p className="text-ui text-muted-foreground">
            No scheduler activity recorded yet.
          </p>
        ) : (
          <>
            {staleTicks.length > 0 ? (
              <p className="text-ui text-destructive">
                {staleTicks.length === 1
                  ? "One tick has not completed recently."
                  : `${formatNumber(staleTicks.length)} ticks have not completed recently.`}
              </p>
            ) : null}
            <ul className="flex flex-wrap gap-2">
              {data.schedulerTicks.map((tick) => (
                <li key={tick.name}>
                  <Badge variant={tick.stale ? "destructive" : "outline"}>
                    {tick.name}: {formatWhen(tick.lastCompletedAt)}
                  </Badge>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold">Sync and connections</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
        <div className="flex flex-wrap gap-2">
          {data.connections.map((row) => (
            <Badge key={row.status} variant="outline">
              {row.status}: {formatNumber(row.count)}
            </Badge>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold">Publishing (24 hours)</h2>
        {data.publish24h.length === 0 ? (
          <p className="text-ui text-muted-foreground">No publish attempts yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {data.publish24h.map((row) => (
              <li key={row.status}>
                <Badge variant={row.status === "failed" ? "destructive" : "secondary"}>
                  {row.status}: {formatNumber(row.count)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold">Failed webhook events</h2>
        {failures.isPending ? (
          <p className="text-ui text-muted-foreground">Loading failures…</p>
        ) : failures.isError ? (
          <p className="text-ui text-destructive">Could not load webhook failures.</p>
        ) : failures.data.length === 0 ? (
          <p className="text-ui text-muted-foreground">
            No failed or dead webhook events.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {failures.data.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-2 rounded-(--nr-radius-card) border border-border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-ui font-medium">{item.eventType}</span>
                    <Badge variant="outline">{item.status}</Badge>
                  </div>
                  <p className="text-caption text-muted-foreground">
                    Received {formatWhen(item.receivedAt)}
                    {item.lastErrorCode ? ` · ${item.lastErrorCode}` : null}
                    {` · retries ${formatNumber(item.retryCount)}`}
                  </p>
                </div>
                {item.status === "failed" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={replay.isPending}
                    onClick={() => replay.mutate(item.id)}
                  >
                    Replay
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
