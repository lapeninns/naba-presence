import { Skeleton } from "@/components/ui/skeleton"

// The shape of a listing page while its segment loads: the area header
// (client eyebrow, serif title with its pill, the tabs over a hairline),
// then a white card the height of a short section. Rendered inside the
// dashboard layout's <main>, so no landmark or h1 of its own.
export default function ListingLoading() {
  return (
    <div
      className="flex flex-col gap-6 px-5 pt-6 md:px-(--np-page-pad-x) md:pt-(--np-page-pad-y)"
      aria-busy="true"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-32" />
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-8 w-64 max-w-full" />
          <Skeleton className="h-[22px] w-24 rounded-(--np-radius-tag)" />
        </div>
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="flex gap-4 border-b border-line pb-3">
        {[0, 1, 2, 3, 4].map((index) => (
          <Skeleton key={index} className="h-4 w-20 shrink-0" />
        ))}
      </div>
      <Skeleton className="h-40 w-full rounded-(--np-radius-card)" />
    </div>
  )
}
