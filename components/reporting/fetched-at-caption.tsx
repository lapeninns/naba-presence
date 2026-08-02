import { formatDate } from "@/lib/format"

export function FetchedAtCaption({
  iso,
  timezone,
  prefix = "As at",
}: {
  iso: string | null
  timezone: string
  prefix?: string
}) {
  return (
    <p className="text-caption text-muted-foreground">
      {iso ? `${prefix} ${formatDate(iso, timezone)}` : "No data yet — nothing to show"}
    </p>
  )
}
