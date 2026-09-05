import { KpiTile } from "@/components/ui/kpi-tile"

/**
 * A headline figure. Kept as a name for the reporting screens; the tile
 * itself is `KpiTile`, so a stat here and a stat on Home are the same shape.
 * `delta` is any node and lands beside the label; for a movement row under
 * the figure use `KpiTile` with `kpiDelta` directly.
 */
export function StatTile({
  label,
  value,
  hint,
  delta,
}: {
  label: string
  value: string
  hint?: string
  delta?: React.ReactNode
}) {
  return <KpiTile label={label} value={value} hint={hint} trailing={delta} />
}
