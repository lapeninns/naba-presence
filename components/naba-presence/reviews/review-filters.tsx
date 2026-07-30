"use client"

import { Search, SlidersHorizontal, X } from "lucide-react"

import type { Queue } from "@/components/naba-presence/reviews/review-queue"
import { readControlValue } from "@/components/naba-presence/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ReviewCounts } from "@/lib/naba-presence-api"

export type ReviewFiltersProps = {
  queue: Queue
  onQueueChange: (value: Queue) => void
  counts: ReviewCounts
  rating: string
  onRatingChange: (value: string) => void
  query: string
  onQueryChange: (value: string) => void
  dateRange: string
  onDateRangeChange: (value: string) => void
  replyState: string
  onReplyStateChange: (value: string) => void
  verification: string
  onVerificationChange: (value: string) => void
  publishState: string
  onPublishStateChange: (value: string) => void
  syncState: string
  onSyncStateChange: (value: string) => void
  sort: "updated_desc" | "rating_desc" | "rating_asc"
  onSortChange: (
    value: "updated_desc" | "rating_desc" | "rating_asc"
  ) => void
  filtersOpen: boolean
  onFiltersOpenChange: (value: boolean) => void
  onReset: () => void
  showLocationFilter: boolean
  location: string
  onLocationChange: (value: string) => void
  locationItems: string[]
}

const QUEUES: { id: Queue; label: string }[] = [
  { id: "all", label: "All reviews" },
  { id: "needs_reply", label: "Needs reply" },
  { id: "awaiting_approval", label: "Awaiting approval" },
  { id: "escalated", label: "Escalated" },
  { id: "published", label: "Published" },
]

function queueCount(queue: Queue, counts: ReviewCounts) {
  if (queue === "all") return counts.total
  if (queue === "needs_reply") {
    return (
      counts.byStatus.new +
      counts.byStatus.drafted +
      counts.byStatus.verified
    )
  }
  if (queue === "awaiting_approval") {
    return (
      counts.byStatus.awaiting_approval + counts.byStatus.publish_requested
    )
  }
  if (queue === "escalated") {
    return (
      counts.byStatus.escalated +
      counts.byStatus.rejected +
      counts.byStatus.failed
    )
  }
  return counts.byStatus.published
}

export function ReviewFilters(props: ReviewFiltersProps) {
  const {
    counts,
    rating,
    onRatingChange,
    query,
    onQueryChange,
    dateRange,
    onDateRangeChange,
    replyState,
    onReplyStateChange,
    verification,
    onVerificationChange,
    publishState,
    onPublishStateChange,
    syncState,
    onSyncStateChange,
    sort,
    onSortChange,
    filtersOpen,
    onFiltersOpenChange,
    onReset,
    showLocationFilter,
    location,
    onLocationChange,
    locationItems,
  } = props

  const activeFilterCount = [
    dateRange !== "all",
    replyState !== "all",
    verification !== "all",
    publishState !== "all",
    syncState !== "all",
  ].filter(Boolean).length

  const activeFilters = [
    dateRange !== "all" && {
      key: "date",
      label: dateRange === "7d" ? "Last 7 days" : "Last 30 days",
      clear: () => onDateRangeChange("all"),
    },
    replyState !== "all" && {
      key: "reply",
      label: replyState === "replied" ? "Replied" : "Unreplied",
      clear: () => onReplyStateChange("all"),
    },
    verification !== "all" && {
      key: "verification",
      label: `Verification: ${verification}`,
      clear: () => onVerificationChange("all"),
    },
    publishState !== "all" && {
      key: "publish",
      label: publishState.replaceAll("_", " "),
      clear: () => onPublishStateChange("all"),
    },
    syncState !== "all" && {
      key: "sync",
      label: `Sync: ${syncState}`,
      clear: () => onSyncStateChange("all"),
    },
  ].filter((filter): filter is Exclude<typeof filter, false> => Boolean(filter))

  return (
    <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center">
      <TabsList
        variant="line"
        aria-label="Review queues"
        className="grid h-auto! w-full grid-cols-2 justify-stretch gap-1 sm:grid-cols-3 xl:flex xl:h-8! xl:[scrollbar-width:none] xl:justify-start xl:overflow-x-auto xl:[&::-webkit-scrollbar]:hidden"
      >
        {QUEUES.map((item) => {
          const count = queueCount(item.id, counts)
          return (
            <TabsTrigger
              key={item.id}
              value={item.id}
              aria-label={`${item.label}, ${count}`}
              className="w-full min-w-0 px-2 text-xs text-muted-foreground xl:w-auto xl:flex-none xl:shrink-0 xl:px-3 xl:text-sm"
            >
              {item.label}
              <span className="font-mono text-[10px] text-muted-foreground">
                {count}
              </span>
            </TabsTrigger>
          )
        })}
      </TabsList>

      <div className="flex flex-1 flex-wrap items-center gap-2 2xl:justify-end">
        <InputGroup className="min-w-[220px] flex-1 2xl:max-w-xs">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(event) => onQueryChange(readControlValue(event))}
            placeholder="Search reviews"
            aria-label="Search reviews"
          />
        </InputGroup>
        {showLocationFilter ? (
          <Combobox
            items={locationItems}
            value={location}
            onValueChange={(value) =>
              onLocationChange(value ?? "All locations")
            }
          >
            <ComboboxInput
              placeholder="All locations"
              aria-label="Filter by location"
              className="w-44"
              showTrigger={false}
            />
            <ComboboxContent>
              <ComboboxEmpty>No locations found.</ComboboxEmpty>
              <ComboboxList>
                {(item: string) => (
                  <ComboboxItem key={item} value={item}>
                    {item}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        ) : null}
        <Select
          value={rating}
          onValueChange={(value) => {
            if (value) onRatingChange(value)
          }}
        >
          <SelectTrigger size="sm" aria-label="Filter by rating">
            <SelectValue>
              {rating === "all" ? "All ratings" : `${rating} stars`}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">All ratings</SelectItem>
              {[5, 4, 3, 2, 1].map((value) => (
                <SelectItem key={value} value={`${value}`}>
                  {value} stars
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          value={sort}
          onValueChange={(value) => {
            if (
              value === "updated_desc" ||
              value === "rating_desc" ||
              value === "rating_asc"
            ) {
              onSortChange(value)
            }
          }}
        >
          <SelectTrigger size="sm" aria-label="Sort reviews">
            <SelectValue>
              {sort === "updated_desc"
                ? "Newest updated"
                : sort === "rating_desc"
                  ? "Highest rating"
                  : "Lowest rating"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="updated_desc">Newest updated</SelectItem>
              <SelectItem value="rating_desc">Highest rating</SelectItem>
              <SelectItem value="rating_asc">Lowest rating</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Sheet open={filtersOpen} onOpenChange={onFiltersOpenChange}>
          <SheetTrigger render={<Button variant="outline" size="sm" />}>
            <SlidersHorizontal data-icon="inline-start" />
            Filters
            {activeFilterCount > 0 ? (
              <Badge variant="secondary" className="font-mono">
                {activeFilterCount}
              </Badge>
            ) : null}
          </SheetTrigger>
          <SheetContent side="right" className="w-[320px]!">
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
              <SheetDescription>
                Narrow the review inbox. Changes apply immediately.
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-4">
              <Field>
                <FieldLabel htmlFor="filter-date">Date range</FieldLabel>
                <Select
                  value={dateRange}
                  onValueChange={(value) =>
                    value && onDateRangeChange(value)
                  }
                >
                  <SelectTrigger
                    id="filter-date"
                    size="sm"
                    aria-label="Filter by date range"
                    className="w-full"
                  >
                    <SelectValue>
                      {dateRange === "all"
                        ? "Any date"
                        : dateRange === "7d"
                          ? "Last 7 days"
                          : "Last 30 days"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">Any date</SelectItem>
                      <SelectItem value="7d">Last 7 days</SelectItem>
                      <SelectItem value="30d">Last 30 days</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="filter-reply">Reply state</FieldLabel>
                <Select
                  value={replyState}
                  onValueChange={(value) =>
                    value && onReplyStateChange(value)
                  }
                >
                  <SelectTrigger
                    id="filter-reply"
                    size="sm"
                    aria-label="Filter by reply state"
                    className="w-full"
                  >
                    <SelectValue>
                      {replyState === "all"
                        ? "Any reply"
                        : replyState === "replied"
                          ? "Replied"
                          : "Unreplied"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">Any reply</SelectItem>
                      <SelectItem value="replied">Replied</SelectItem>
                      <SelectItem value="unreplied">Unreplied</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="filter-verification">
                  Verification
                </FieldLabel>
                <Select
                  value={verification}
                  onValueChange={(value) =>
                    value && onVerificationChange(value)
                  }
                >
                  <SelectTrigger
                    id="filter-verification"
                    size="sm"
                    aria-label="Filter by verification"
                    className="w-full"
                  >
                    <SelectValue>
                      {verification === "all"
                        ? "Any verification"
                        : `Verification: ${verification}`}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">Any verification</SelectItem>
                      <SelectItem value="pass">Passed</SelectItem>
                      <SelectItem value="warn">Warning</SelectItem>
                      <SelectItem value="fail">Failed</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="filter-publish">
                  Publish status
                </FieldLabel>
                <Select
                  value={publishState}
                  onValueChange={(value) =>
                    value && onPublishStateChange(value)
                  }
                >
                  <SelectTrigger
                    id="filter-publish"
                    size="sm"
                    aria-label="Filter by publish status"
                    className="w-full"
                  >
                    <SelectValue>
                      {publishState === "all"
                        ? "Any publish status"
                        : publishState.replaceAll("_", " ")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">
                        Any publish status
                      </SelectItem>
                      <SelectItem value="not_published">
                        Not published
                      </SelectItem>
                      <SelectItem value="awaiting_approval">
                        Awaiting approval
                      </SelectItem>
                      <SelectItem value="published">Published</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="filter-sync">Sync status</FieldLabel>
                <Select
                  value={syncState}
                  onValueChange={(value) =>
                    value && onSyncStateChange(value)
                  }
                >
                  <SelectTrigger
                    id="filter-sync"
                    size="sm"
                    aria-label="Filter by sync status"
                    className="w-full"
                  >
                    <SelectValue>
                      {syncState === "all"
                        ? "Any sync status"
                        : `Sync: ${syncState}`}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">Any sync status</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="running">Running</SelectItem>
                      <SelectItem value="succeeded">Succeeded</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <SheetFooter>
              <Button variant="outline" onClick={onReset}>
                Clear all filters
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
        {activeFilters.map((filter) => (
          <Badge
            key={filter.key}
            variant="secondary"
            className="gap-1 pr-1"
          >
            {filter.label}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove ${filter.label} filter`}
              onClick={filter.clear}
              className="size-4 rounded-full"
            >
              <X />
            </Button>
          </Badge>
        ))}
      </div>
    </div>
  )
}
