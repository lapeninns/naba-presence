import { ToggleGroup, ToggleGroupItem } from "NabaReview"
import { Columns3, LayoutList, Star, Table2 } from "lucide-react"

const RATINGS = [5, 4, 3, 2, 1]

export function RatingFilter() {
  return (
    <ToggleGroup
      multiple
      variant="outline"
      spacing={0}
      defaultValue={["5", "4"]}
      aria-label="Filter the review queue by rating"
    >
      {RATINGS.map((rating) => (
        <ToggleGroupItem
          key={rating}
          value={String(rating)}
          aria-label={`${rating} stars`}
        >
          {rating}
          <Star data-icon="inline-end" className="fill-rating text-rating" />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

export function ViewSwitcher() {
  return (
    <ToggleGroup
      variant="outline"
      spacing={0}
      defaultValue={["list"]}
      aria-label="Queue layout"
    >
      <ToggleGroupItem value="list">
        <LayoutList data-icon="inline-start" />
        List
      </ToggleGroupItem>
      <ToggleGroupItem value="board">
        <Columns3 data-icon="inline-start" />
        Board
      </ToggleGroupItem>
      <ToggleGroupItem value="table">
        <Table2 data-icon="inline-start" />
        Table
      </ToggleGroupItem>
    </ToggleGroup>
  )
}

export function Spacing() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">
          spacing 0 — segments share their borders
        </span>
        <ToggleGroup variant="outline" spacing={0} defaultValue={["awaiting"]}>
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="awaiting">Awaiting reply</ToggleGroupItem>
          <ToggleGroupItem value="replied">Replied</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">
          spacing 2 (default) — detached chips
        </span>
        <ToggleGroup variant="outline" defaultValue={["awaiting"]}>
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="awaiting">Awaiting reply</ToggleGroupItem>
          <ToggleGroupItem value="replied">Replied</ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>
  )
}

export function Sizes() {
  return (
    <div className="flex flex-col gap-3">
      <ToggleGroup
        variant="outline"
        size="sm"
        spacing={0}
        defaultValue={["central"]}
      >
        <ToggleGroupItem value="central">Central</ToggleGroupItem>
        <ToggleGroupItem value="riverside">Riverside</ToggleGroupItem>
        <ToggleGroupItem value="airport">Airport</ToggleGroupItem>
      </ToggleGroup>
      <ToggleGroup variant="outline" spacing={0} defaultValue={["central"]}>
        <ToggleGroupItem value="central">Central</ToggleGroupItem>
        <ToggleGroupItem value="riverside">Riverside</ToggleGroupItem>
        <ToggleGroupItem value="airport">Airport</ToggleGroupItem>
      </ToggleGroup>
      <ToggleGroup
        variant="outline"
        size="lg"
        spacing={0}
        defaultValue={["central"]}
      >
        <ToggleGroupItem value="central">Central</ToggleGroupItem>
        <ToggleGroupItem value="riverside">Riverside</ToggleGroupItem>
        <ToggleGroupItem value="airport">Airport</ToggleGroupItem>
      </ToggleGroup>
    </div>
  )
}

export function Vertical() {
  return (
    <ToggleGroup
      orientation="vertical"
      variant="outline"
      spacing={0}
      defaultValue={["escalated"]}
      aria-label="Reply state"
    >
      <ToggleGroupItem value="awaiting">Awaiting reply</ToggleGroupItem>
      <ToggleGroupItem value="replied">Replied</ToggleGroupItem>
      <ToggleGroupItem value="escalated">Escalated</ToggleGroupItem>
    </ToggleGroup>
  )
}
