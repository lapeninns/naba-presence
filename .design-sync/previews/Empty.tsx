import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "NabaReview"
import { CheckCheck, Filter, SearchX, Unplug } from "lucide-react"

export function NoResults() {
  return (
    <Empty className="max-w-md">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchX />
        </EmptyMedia>
        <EmptyTitle>No reviews match these filters</EmptyTitle>
        <EmptyDescription>
          Nothing in the last 7 days is rated 1–2 stars at Lapen Inn Riverside.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline">
          <Filter />
          Clear filters
        </Button>
      </EmptyContent>
    </Empty>
  )
}

export function DashedSurface() {
  return (
    <Empty className="max-w-md border border-border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Unplug />
        </EmptyMedia>
        <EmptyTitle>No Google profile connected</EmptyTitle>
        <EmptyDescription>
          Connect a Google Business Profile to start importing reviews for this
          location.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button>Connect profile</Button>
          <Button variant="ghost">Read the setup guide</Button>
        </div>
      </EmptyContent>
    </Empty>
  )
}

export function InboxZero() {
  return (
    <Empty className="max-w-md">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CheckCheck />
        </EmptyMedia>
        <EmptyTitle>Every review has a reply</EmptyTitle>
        <EmptyDescription>
          All 39 reviews for Lapen Inn Riverside were answered. Median response
          time this week was 3h 12m.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export function WithoutMedia() {
  return (
    <Empty className="max-w-md">
      <EmptyHeader>
        <EmptyTitle>No escalations</EmptyTitle>
        <EmptyDescription>
          Reviews flagged for a manager appear here. <a href="#">Adjust the
          escalation rules</a> to change what gets flagged.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
