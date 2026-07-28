import {
  Avatar,
  AvatarFallback,
  Badge,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Separator,
} from "NabaReview"
import { Star } from "lucide-react"

// Enrichment only — never put required information behind hover, it is
// unreachable on touch. `HoverCardTrigger` renders an <a> by default; the
// popup is a fixed `w-72` surface that portals to the body.

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden
          className={i <= value ? "size-3 fill-rating text-rating" : "size-3 text-muted-foreground/40"}
        />
      ))}
    </span>
  )
}

export function InlineInProse() {
  return (
    <div className="w-full max-w-md">
      <p className="text-sm text-foreground">
        Escalated because{" "}
        <HoverCard defaultOpen>
          <HoverCardTrigger className="font-medium text-primary underline-offset-4">
            Lena&nbsp;Fischer
          </HoverCardTrigger>
          <HoverCardContent>
            <div className="flex items-center gap-3">
              <Avatar>
                <AvatarFallback>LF</AvatarFallback>
              </Avatar>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">Lena Fischer</span>
                <span className="text-xs text-muted-foreground">2 reviews · Riverside</span>
              </div>
            </div>
            <Separator className="my-3" />
            <div className="flex items-center gap-2">
              <Stars value={2} />
              <span className="font-mono text-xs text-muted-foreground">2.0 avg</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Both reviews mention late check-in at Riverside.
            </p>
          </HoverCardContent>
        </HoverCard>{" "}
        rated us 2 stars twice.
      </p>
    </div>
  )
}

export function ReviewerHistory() {
  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      <span className="text-sm text-muted-foreground">
        Awaiting reply · hover a reviewer to see their history without leaving
        the queue.
      </span>
      <HoverCard defaultOpen>
        <HoverCardTrigger className="w-fit text-sm font-medium text-primary underline-offset-4">
          Priya Sharma
        </HoverCardTrigger>
        <HoverCardContent>
          <div className="flex items-center gap-3">
            <Avatar>
              <AvatarFallback>PS</AvatarFallback>
            </Avatar>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">Priya Sharma</span>
              <span className="text-xs text-muted-foreground">Local Guide · Level 6</span>
            </div>
          </div>
          <Separator className="my-3" />
          <div className="flex items-center gap-2">
            <Stars value={5} />
            <span className="font-mono text-xs text-muted-foreground">4.8 avg</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            7 reviews across Central and Airport since 2023. Never escalated.
          </p>
        </HoverCardContent>
      </HoverCard>
    </div>
  )
}

export function LocationSummary() {
  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      <span className="text-sm text-muted-foreground">Escalated from</span>
      <HoverCard defaultOpen>
        <HoverCardTrigger className="w-fit text-sm font-medium text-primary underline-offset-4">
          Lapen Inn — Riverside
        </HoverCardTrigger>
        <HoverCardContent side="right">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground">
              Lapen Inn — Riverside
            </span>
            <Badge variant="secondary">Connected</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            12 Weir Street · 84 rooms
          </p>
          <Separator className="my-3" />
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Reviews · 90d</span>
            <span className="font-mono text-foreground">39</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Replied</span>
            <span className="font-mono text-success">30</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Average rating</span>
            <span className="font-mono text-foreground">4.4</span>
          </div>
        </HoverCardContent>
      </HoverCard>
    </div>
  )
}

export function ReplyAuthor() {
  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      <span className="text-sm text-muted-foreground">Reply drafted by</span>
      <HoverCard defaultOpen>
        <HoverCardTrigger className="w-fit text-sm font-medium text-primary underline-offset-4">
          Tom Okafor
        </HoverCardTrigger>
        <HoverCardContent align="start">
          <div className="flex items-center gap-3">
            <Avatar>
              <AvatarFallback>TO</AvatarFallback>
            </Avatar>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">Tom Okafor</span>
              <span className="text-xs text-muted-foreground">
                Guest relations · Riverside
              </span>
            </div>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Drafted 14 replies this week. Median turnaround{" "}
            <span className="font-mono text-foreground">3h 20m</span>.
          </p>
        </HoverCardContent>
      </HoverCard>
    </div>
  )
}
