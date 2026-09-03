import { Skeleton } from "@/components/ui/skeleton"

export default function PerformanceLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-(--nr-gap-section)">
      <Skeleton className="h-9 w-72 rounded-(--nr-radius-control)" />
      <div className="grid gap-(--nr-gap-card) sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-(--nr-radius-card)" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-(--nr-radius-card)" />
    </div>
  )
}
