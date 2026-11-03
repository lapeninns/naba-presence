import { Skeleton } from "@/components/ui/skeleton"

// Without this file /clients/new streams in behind the index's wide table
// skeleton (the parent segment's loading.tsx) and then jumps to a one-column
// form. A plain `div`, not `PageFrame`, so there is still only one `<main>`:
// `PageFrame width="narrow"`'s gutters and max width, `PageHeader`'s eyebrow,
// title and two-line description, then the form card's three fields and
// the action row beneath it.
export default function Loading() {
  return (
    <div className="@container mx-auto flex w-full max-w-(--np-page-narrow-width) flex-col gap-(--np-gap-section) px-5 pt-6 pb-12 md:px-(--np-page-pad-x) md:pt-(--np-page-pad-y)">
      <p role="status" className="sr-only">
        Loading the new client form…
      </p>
      <div aria-hidden className="flex flex-col gap-1">
        <Skeleton className="h-4 w-14" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-6 w-full max-w-120" />
        <Skeleton className="h-6 w-48" />
      </div>
      <div aria-hidden className="flex flex-col gap-4">
        <div className="flex flex-col gap-5 rounded-(--np-radius-card) border border-line bg-surface p-(--np-card-pad)">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-(--np-field-h) w-full rounded-(--np-radius-control) max-md:h-(--np-touch)" />
            <Skeleton className="h-3.5 w-64 max-w-full" />
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3.5 w-56 max-w-full" />
            <div className="flex gap-2">
              {[0, 1, 2, 3, 4, 5, 6].map((index) => (
                <Skeleton
                  key={index}
                  className="size-8 shrink-0 rounded-(--np-radius-control) pointer-coarse:size-11"
                />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-24 w-full rounded-(--np-radius-control)" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 max-md:hidden">
          <Skeleton className="h-(--np-control-h) w-20 rounded-(--np-radius-control)" />
          <Skeleton className="h-(--np-control-h) w-32 rounded-(--np-radius-control)" />
        </div>
      </div>
    </div>
  )
}
