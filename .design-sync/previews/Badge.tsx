import { Badge } from "NabaReview"
import {
  AlertTriangle,
  Check,
  Clock,
  ExternalLink,
  RefreshCw,
  Star,
} from "lucide-react"

export function Variants() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge>Replied</Badge>
      <Badge variant="secondary">Awaiting reply</Badge>
      <Badge variant="destructive">Escalated</Badge>
      <Badge variant="outline">Draft</Badge>
      <Badge variant="ghost">Archived</Badge>
      <Badge variant="link">View on Google</Badge>
    </div>
  )
}

export function ReviewStatus() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge>
        <Check data-icon="inline-start" />
        Replied
      </Badge>
      <Badge variant="secondary">
        <Clock data-icon="inline-start" />
        Awaiting reply
      </Badge>
      <Badge variant="destructive">
        <AlertTriangle data-icon="inline-start" />
        Escalated
      </Badge>
      <Badge variant="outline">
        <RefreshCw data-icon="inline-start" />
        Syncing
      </Badge>
    </div>
  )
}

export function Counts() {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <span className="inline-flex items-center gap-2 text-sm text-foreground">
        Central
        <Badge variant="secondary" className="font-mono tabular-nums">
          64
        </Badge>
      </span>
      <span className="inline-flex items-center gap-2 text-sm text-foreground">
        Riverside
        <Badge variant="secondary" className="font-mono tabular-nums">
          39
        </Badge>
      </span>
      <span className="inline-flex items-center gap-2 text-sm text-foreground">
        Airport
        <Badge variant="secondary" className="font-mono tabular-nums">
          25
        </Badge>
      </span>
      <span className="inline-flex items-center gap-2 text-sm text-foreground">
        Needs reply
        <Badge className="font-mono tabular-nums">15</Badge>
      </span>
    </div>
  )
}

export function RatingBadges() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline">
        <Star data-icon="inline-start" className="fill-rating text-rating" />
        4.8
      </Badge>
      <Badge variant="outline">
        <Star data-icon="inline-start" className="fill-rating text-rating" />
        4.6
      </Badge>
      <Badge variant="outline">
        <Star data-icon="inline-start" className="fill-rating text-rating" />
        4.4
      </Badge>
      <Badge variant="destructive">
        <Star data-icon="inline-start" />
        2.1
      </Badge>
    </div>
  )
}

export function AsLink() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge render={<a href="#reviews" />}>
        Lapen Inn — Central
        <ExternalLink data-icon="inline-end" />
      </Badge>
      <Badge variant="secondary" render={<a href="#reviews" />}>
        Riverside
        <ExternalLink data-icon="inline-end" />
      </Badge>
      <Badge variant="outline" render={<a href="#reviews" />}>
        Airport
        <ExternalLink data-icon="inline-end" />
      </Badge>
    </div>
  )
}
