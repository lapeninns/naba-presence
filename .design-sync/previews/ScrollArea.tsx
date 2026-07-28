import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ScrollArea,
  Separator,
} from "NabaReview"
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

const FEED = [
  { name: "Priya Sharma", rating: 5, age: "2d", body: "Front desk could not have been kinder and the room was spotless." },
  { name: "Tom Okafor", rating: 4, age: "3d", body: "Great value near the station. Breakfast finishes a little early." },
  { name: "Lena Fischer", rating: 2, age: "5d", body: "Nobody at the late check-in desk after midnight — waited 40 minutes." },
  { name: "Marco Silva", rating: 5, age: "1w", body: "Airport shuttle ran exactly on time both ways. Would book again." },
  { name: "Hannah Boyd", rating: 4, age: "1w", body: "Quiet room facing the courtyard, very comfortable bed." },
  { name: "Diego Rojas", rating: 3, age: "2w", body: "Room was fine but the lift was out of service all weekend." },
  { name: "Aisha Bello", rating: 5, age: "2w", body: "Staff moved us to a river-view room for our anniversary." },
]

const LOCATIONS = [
  { name: "Lapen Inn Central", city: "Manchester", avg: "4.7", pending: 6 },
  { name: "Lapen Inn Riverside", city: "Manchester", avg: "4.4", pending: 4 },
  { name: "Lapen Inn Airport", city: "Manchester", avg: "4.8", pending: 2 },
  { name: "Lapen Inn Northgate", city: "Leeds", avg: "4.5", pending: 0 },
  { name: "Lapen Inn Quayside", city: "Newcastle", avg: "4.2", pending: 3 },
  { name: "Lapen Inn Old Town", city: "Edinburgh", avg: "4.6", pending: 1 },
  { name: "Lapen Inn Harbour", city: "Bristol", avg: "4.3", pending: 5 },
  { name: "Lapen Inn Parkway", city: "Sheffield", avg: "4.1", pending: 0 },
]

export function ReviewFeed() {
  return (
    <ScrollArea className="h-[260px] w-full max-w-sm rounded-2xl border border-border bg-card">
      <div className="flex flex-col gap-4 p-4">
        {FEED.map((r) => (
          <div key={r.name} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">{r.name}</span>
              <span className="font-mono text-xs text-muted-foreground">{r.age}</span>
            </div>
            <Stars value={r.rating} />
            <p className="text-sm text-muted-foreground">{r.body}</p>
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}

export function LocationList() {
  return (
    <ScrollArea className="h-[260px] w-full max-w-sm rounded-2xl border border-border bg-card">
      <div className="p-1">
        {LOCATIONS.map((l, i) => (
          <div key={l.name}>
            {i > 0 ? <Separator /> : null}
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm text-foreground">{l.name}</span>
                <span className="text-xs text-muted-foreground">{l.city}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{l.avg}</span>
                {l.pending > 0 ? (
                  <Badge variant="secondary">{l.pending}</Badge>
                ) : (
                  <Badge variant="outline">0</Badge>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}

export function LongReplyThread() {
  return (
    <ScrollArea className="h-[260px] w-full max-w-sm rounded-2xl border border-border bg-card">
      <div className="flex flex-col gap-3 p-4 text-sm">
        <p className="font-medium text-foreground">Lena Fischer · Central</p>
        <p className="text-muted-foreground">
          We arrived on the 23:50 train and there was nobody at the late check-in desk.
          After forty minutes a night porter appeared and could not find our booking,
          which had been paid in full three weeks earlier.
        </p>
        <p className="text-muted-foreground">
          The room itself was clean and quiet, and the breakfast team the next morning
          were lovely, so this is really about the handover after midnight.
        </p>
        <Separator />
        <p className="font-medium text-foreground">Lapen Inns · draft reply</p>
        <p className="text-muted-foreground">
          Lena, thank you for setting this out so clearly. The late desk is now staffed
          until 01:00 every night and the duty manager holds the booking list on paper as
          a backup. We have credited your stay and would like to host you again.
        </p>
      </div>
    </ScrollArea>
  )
}

export function InsideCard() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-base">Awaiting reply</CardTitle>
        <CardDescription>12 reviews across three locations.</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[260px] w-full">
          {/* pr-2 keeps the row content clear of the 10px overlay scrollbar */}
          <div className="flex flex-col gap-3 pr-2">
            {FEED.map((r) => (
              <div key={r.name} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm text-foreground">{r.name}</span>
                  <Stars value={r.rating} />
                </div>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {r.age}
                </span>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
