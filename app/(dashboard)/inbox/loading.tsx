import { Skeleton } from "@/components/ui/skeleton"

export default function InboxLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3 p-6">
      <Skeleton className="h-9 w-full max-w-md rounded-(--np-radius-control)" />
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <Skeleton key={index} className="h-16 w-full rounded-(--np-radius-card)" />
      ))}
    </div>
  )
}
