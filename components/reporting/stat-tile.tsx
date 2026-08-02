import { Card, CardContent } from "@/components/ui/card"

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
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1">
        <p className="text-ui text-muted-foreground">{label}</p>
        <div className="flex items-baseline gap-2">
          <p className="text-page-title font-semibold tracking-tight tabular-nums">{value}</p>
          {delta}
        </div>
        {hint ? <p className="text-caption text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}
