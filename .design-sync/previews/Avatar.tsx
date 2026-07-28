import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from "NabaReview"
import { Check, Plus, Star } from "lucide-react"

const REVIEWERS = [
  { initials: "PS", name: "Priya Sharma" },
  { initials: "TO", name: "Tom Okafor" },
  { initials: "LF", name: "Lena Fischer" },
  { initials: "MS", name: "Marco Silva" },
]

export function Fallbacks() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {REVIEWERS.map((r) => (
        <Avatar key={r.initials} aria-label={r.name}>
          <AvatarFallback>{r.initials}</AvatarFallback>
        </Avatar>
      ))}
      <Avatar aria-label="Anonymous reviewer">
        <AvatarFallback className="bg-muted-foreground text-background">?</AvatarFallback>
      </Avatar>
    </div>
  )
}

export function Sizes() {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex flex-col items-center gap-2">
        <Avatar size="sm">
          <AvatarFallback>PS</AvatarFallback>
        </Avatar>
        <span className="font-mono text-xs text-muted-foreground">sm</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <Avatar>
          <AvatarFallback>TO</AvatarFallback>
        </Avatar>
        <span className="font-mono text-xs text-muted-foreground">default</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <Avatar size="lg">
          <AvatarFallback>LF</AvatarFallback>
        </Avatar>
        <span className="font-mono text-xs text-muted-foreground">lg</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <Avatar className="size-16">
          <AvatarFallback className="text-base">MS</AvatarFallback>
        </Avatar>
        <span className="font-mono text-xs text-muted-foreground">size-16</span>
      </div>
    </div>
  )
}

export function WithStatusBadge() {
  return (
    <div className="flex flex-wrap items-center gap-6">
      <Avatar size="lg" aria-label="Priya Sharma — replied">
        <AvatarFallback>PS</AvatarFallback>
        <AvatarBadge className="bg-success text-background">
          <Check />
        </AvatarBadge>
      </Avatar>
      <Avatar size="lg" aria-label="Lena Fischer — escalated">
        <AvatarFallback>LF</AvatarFallback>
        <AvatarBadge className="bg-destructive" />
      </Avatar>
      <Avatar aria-label="Tom Okafor — awaiting reply">
        <AvatarFallback>TO</AvatarFallback>
        <AvatarBadge />
      </Avatar>
      <Avatar size="sm" aria-label="Marco Silva — awaiting reply">
        <AvatarFallback>MS</AvatarFallback>
        <AvatarBadge />
      </Avatar>
    </div>
  )
}

export function Group() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        {/* size=lg keeps two-letter initials clear of the -space-x-2 overlap. */}
        <AvatarGroup>
          {REVIEWERS.map((r) => (
            <Avatar key={r.initials} size="lg" aria-label={r.name}>
              <AvatarFallback>{r.initials}</AvatarFallback>
            </Avatar>
          ))}
          <AvatarGroupCount className="font-mono text-xs">+9</AvatarGroupCount>
        </AvatarGroup>
        <span className="text-xs text-muted-foreground">
          13 reviewers this week · Central
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <AvatarGroup>
          <Avatar size="lg" aria-label="Priya Sharma">
            <AvatarFallback>PS</AvatarFallback>
          </Avatar>
          <Avatar size="lg" aria-label="Tom Okafor">
            <AvatarFallback>TO</AvatarFallback>
          </Avatar>
          <Avatar size="lg" aria-label="Lena Fischer">
            <AvatarFallback>LF</AvatarFallback>
          </Avatar>
          <AvatarGroupCount>
            <Plus />
          </AvatarGroupCount>
        </AvatarGroup>
        <span className="text-xs text-muted-foreground">
          Reply team · Riverside — invite a teammate
        </span>
      </div>
    </div>
  )
}

export function ReviewerRow() {
  return (
    <div className="flex max-w-md items-start gap-3">
      <Avatar size="lg">
        <AvatarFallback>PS</AvatarFallback>
        <AvatarBadge className="bg-success text-background">
          <Check />
        </AvatarBadge>
      </Avatar>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">Priya Sharma</span>
          <span className="inline-flex items-center gap-0.5" aria-label="5 of 5 stars">
            {[1, 2, 3, 4, 5].map((i) => (
              <Star key={i} aria-hidden className="size-3.5 fill-rating text-rating" />
            ))}
          </span>
          <span className="font-mono text-xs text-muted-foreground">2d</span>
        </div>
        <p className="text-sm text-muted-foreground">
          Front desk went out of their way to hold our room after a delayed flight.
          Replied 4 hours ago.
        </p>
      </div>
    </div>
  )
}
