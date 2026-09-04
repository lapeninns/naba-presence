import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div
      className="flex flex-col gap-5 px-5 py-6 md:px-(--np-page-pad-x)"
      aria-busy="true"
    >
      <Skeleton className="h-9 w-56" />
      <div className="flex gap-8">
        <Skeleton className="hidden h-72 w-56 lg:block" />
        <Skeleton className="h-72 flex-1" />
      </div>
    </div>
  )
}
