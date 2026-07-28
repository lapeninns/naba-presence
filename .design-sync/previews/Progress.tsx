import { Progress, ProgressLabel, ProgressValue } from "NabaReview"

export function Default() {
  return (
    <div className="max-w-md">
      <Progress value={72} />
    </div>
  )
}

export function WithLabelAndValue() {
  return (
    <Progress value={46} className="max-w-md">
      <ProgressLabel>Importing reviews from Google Business Profile</ProgressLabel>
      <ProgressValue />
    </Progress>
  )
}

export function ResponseRateByLocation() {
  return (
    <div className="flex max-w-md flex-col gap-5">
      {[
        { location: "Lapen Inn Central", value: 91 },
        { location: "Lapen Inn Riverside", value: 77 },
        { location: "Lapen Inn Airport", value: 100 },
      ].map((row) => (
        <Progress key={row.location} value={row.value}>
          <ProgressLabel>{row.location}</ProgressLabel>
          <ProgressValue />
        </Progress>
      ))}
    </div>
  )
}

export function Inline() {
  return (
    <div className="flex max-w-md flex-col gap-3">
      {[
        { theme: "Service", value: 78, mentions: "142" },
        { theme: "Location", value: 63, mentions: "116" },
        { theme: "Breakfast", value: 48, mentions: "88" },
        { theme: "Room comfort", value: 31, mentions: "57" },
      ].map((row) => (
        <div key={row.theme} className="flex items-center gap-3 text-sm">
          <span className="min-w-32">{row.theme}</span>
          <Progress value={row.value} className="w-28" />
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            {row.mentions} mentions
          </span>
        </div>
      ))}
    </div>
  )
}

export function Values() {
  return (
    <div className="flex max-w-md flex-col gap-4">
      {[0, 25, 50, 75, 100].map((v) => (
        <div key={v} className="flex items-center gap-3">
          <Progress value={v} className="flex-1" />
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {v}%
          </span>
        </div>
      ))}
    </div>
  )
}
