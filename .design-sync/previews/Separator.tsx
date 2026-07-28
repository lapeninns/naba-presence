import { Separator } from "NabaReview"
import { Star } from "lucide-react"

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden
          className={i <= value ? "size-3.5 fill-rating text-rating" : "size-3.5 text-muted-foreground/40"}
        />
      ))}
    </span>
  )
}

const REVIEWS = [
  { name: "Priya Sharma", location: "Central", rating: 5, age: "2d" },
  { name: "Tom Okafor", location: "Riverside", rating: 4, age: "3d" },
  { name: "Lena Fischer", location: "Central", rating: 2, age: "5d" },
]

export function BetweenReviewRows() {
  return (
    <div className="w-full max-w-sm rounded-2xl border border-border bg-card px-4 py-1">
      {REVIEWS.map((r, i) => (
        <div key={r.name}>
          {i > 0 ? <Separator /> : null}
          <div className="flex items-center justify-between gap-3 py-3">
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-foreground">{r.name}</span>
              <span className="text-xs text-muted-foreground">{r.location}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Stars value={r.rating} />
              <span className="font-mono text-xs text-muted-foreground">{r.age}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function MetricStrip() {
  return (
    <div className="flex w-full max-w-sm items-stretch justify-between gap-4 rounded-2xl border border-border bg-card px-4 py-3">
      <div className="flex flex-col">
        <span className="text-xs text-muted-foreground">Reviews</span>
        <span className="font-mono text-lg leading-tight text-foreground">128</span>
      </div>
      <Separator orientation="vertical" />
      <div className="flex flex-col">
        <span className="text-xs text-muted-foreground">Awaiting</span>
        <span className="font-mono text-lg leading-tight text-foreground">12</span>
      </div>
      <Separator orientation="vertical" />
      <div className="flex flex-col">
        <span className="text-xs text-muted-foreground">Avg rating</span>
        <span className="font-mono text-lg leading-tight text-foreground">4.6</span>
      </div>
    </div>
  )
}

export function WithLabel() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <p className="text-sm text-foreground">
        Thank you for staying with us, Marco — we are delighted the airport shuttle
        worked out.
      </p>
      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs whitespace-nowrap text-muted-foreground">
          or write your own
        </span>
        <Separator className="flex-1" />
      </div>
      <p className="text-sm text-muted-foreground">
        Drafts are saved per location and never posted automatically.
      </p>
    </div>
  )
}

export function SectionDivider() {
  return (
    <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-medium text-foreground">Lapen Inn Central</span>
        <span className="font-mono text-xs text-muted-foreground">GBP-4471</span>
      </div>
      <Separator />
      <div className="flex flex-col gap-1 px-4 py-3">
        <span className="text-sm text-foreground">Auto-reply for 5-star reviews</span>
        <span className="text-xs text-muted-foreground">
          Publishes the approved template after a 2-hour hold.
        </span>
      </div>
      <Separator />
      <div className="px-4 py-3">
        <span className="text-xs text-muted-foreground">
          Last synced <span className="font-mono">4 min</span> ago
        </span>
      </div>
    </div>
  )
}
