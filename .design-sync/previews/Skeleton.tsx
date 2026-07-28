import { Skeleton } from "NabaReview"

export function ReviewRow() {
  return (
    <div className="flex max-w-md items-start gap-3">
      <Skeleton className="size-10 rounded-full" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      <Skeleton className="h-3 w-10" />
    </div>
  )
}

export function ReviewCard() {
  return (
    <div className="flex max-w-md flex-col gap-4 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-28" />
        </div>
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-8 w-24 rounded-2xl" />
        <Skeleton className="h-8 w-24 rounded-2xl" />
      </div>
    </div>
  )
}

export function QueueList() {
  return (
    <div className="flex max-w-md flex-col">
      {["central", "riverside", "airport", "harbour"].map((row) => (
        <div
          key={row}
          className="flex items-center gap-3 border-b border-border py-3"
        >
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-10" />
          <Skeleton className="ml-auto h-3 w-10" />
        </div>
      ))}
    </div>
  )
}

export function MetricTiles() {
  return (
    <div className="grid max-w-md grid-cols-2 gap-3">
      {["rating", "awaiting", "replied", "median"].map((tile) => (
        <div
          key={tile}
          className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4"
        >
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-10" />
          <Skeleton className="h-2 w-full" />
        </div>
      ))}
    </div>
  )
}
