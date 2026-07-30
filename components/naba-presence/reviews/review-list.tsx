"use client"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Stars, StatusBadge } from "@/components/naba-presence/shared"
import { Review } from "@/lib/naba-presence-data"
import { cn } from "@/lib/utils"

export function ReviewList({
  reviews,
  selectedId,
  onSelect,
  selectedRowRef,
}: {
  reviews: Review[]
  selectedId: string
  onSelect: (id: string) => void
  selectedRowRef: React.RefObject<HTMLButtonElement | null>
}) {
  return (
    <ItemGroup className="gap-2.5 p-3 md:p-4">
      {reviews.map((review) => (
        <ReviewRow
          key={review.id}
          review={review}
          selected={review.id === selectedId}
          buttonRef={
            review.id === selectedId ? selectedRowRef : undefined
          }
          onSelect={() => onSelect(review.id)}
        />
      ))}
    </ItemGroup>
  )
}

function ReviewRow({
  review,
  selected,
  buttonRef,
  onSelect,
}: {
  review: Review
  selected: boolean
  buttonRef?: React.Ref<HTMLButtonElement>
  onSelect: () => void
}) {
  return (
    // `ItemGroup` sets `role="list"`, which requires `listitem`-role owned
    // elements (axe `aria-required-children`, verified against this repo's
    // axe-core build). `Item`'s `render` prop replaces its whole root
    // element, so the button itself can't also carry `role="listitem"`
    // without losing its `button` role (breaking the a11y suite's
    // `getByRole("button")` row lookups). Wrapping keeps the row a real,
    // separately-queryable button while giving `ItemGroup` a valid child.
    <div role="listitem">
      <Item
        render={
          <button
            ref={buttonRef}
            type="button"
            onClick={onSelect}
            aria-current={selected ? "true" : undefined}
          />
        }
        size="sm"
        className={cn(
          "rounded-(--nr-radius-card) border-[var(--nr-surface-glass-border)] bg-[var(--nr-surface-card-translucent)] text-left shadow-(--nr-shadow-card) transition-[color,background-color,border-color,box-shadow,transform] hover:-translate-y-px hover:shadow-(--nr-shadow-hover) motion-reduce:transform-none",
          selected
            ? "border-primary/45 bg-card"
            : "hover:border-border hover:bg-card/85"
        )}
      >
        <ItemMedia>
          <Avatar size="sm">
            <AvatarFallback>{review.initials}</AvatarFallback>
          </Avatar>
        </ItemMedia>
        <ItemContent>
          <div className="flex w-full items-start justify-between gap-3">
            <ItemTitle>{review.reviewer}</ItemTitle>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {review.postedAt.split(",")[0]}
            </span>
          </div>
          <ItemDescription className="line-clamp-1">
            {review.location}
          </ItemDescription>
          <Stars value={review.rating} compact />
          <ItemDescription>{review.excerpt}</ItemDescription>
          <div className="mt-1">
            <StatusBadge status={review.status} />
          </div>
        </ItemContent>
      </Item>
    </div>
  )
}
