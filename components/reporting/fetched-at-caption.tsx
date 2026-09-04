import { formatDate } from "@/lib/format"

/**
 * When the figures beside this caption were last collected.
 *
 * `iso` is null in two situations that are not the same thing, and this used
 * to answer both with "No data yet — nothing to show": while the query is
 * still in flight (`overview?.to ?? null` is null before the response lands),
 * and once it has returned with nothing collected. The first is a sentence
 * about Google that nobody had asked Google yet, shown on every load of the
 * pulse chart and the keywords tab.
 *
 * Note the wording avoids claiming a Google round-trip: the presence endpoint
 * reads `performance_metric_daily` and `sync_checkpoint` from our own
 * database, so "checking with Google" would be false.
 */
export function FetchedAtCaption({
  iso,
  timezone,
  prefix = "As at",
  pending = false,
}: {
  iso: string | null
  timezone: string
  prefix?: string
  /** The query behind these figures has not answered yet. */
  pending?: boolean
}) {
  if (iso) {
    return (
      <p className="text-caption text-muted-foreground">
        {`${prefix} ${formatDate(iso, timezone)}`}
      </p>
    )
  }
  return (
    <p className="text-caption text-muted-foreground" role={pending ? "status" : undefined}>
      {pending ? "Loading…" : "Nothing collected yet"}
    </p>
  )
}
