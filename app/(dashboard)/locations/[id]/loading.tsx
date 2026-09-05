import { Skeleton } from "@/components/ui/skeleton"

// The shape of an editor section: its heading and one-line description,
// then a white card the height of a short form. The workspace layout above
// already owns the page's landmark and h1.
export default function LocationTabLoading() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-40 w-full rounded-(--np-radius-card)" />
    </div>
  )
}
