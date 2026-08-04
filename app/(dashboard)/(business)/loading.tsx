import { Skeleton } from "@/components/ui/skeleton"

// Plain `div`, not PageFrame: this renders INSIDE (business)/layout.tsx, which
// already owns the one true <main>. Adding a PageFrame here would nest a
// second landmark. Same rule as app/(dashboard)/loading.tsx and
// app/(dashboard)/settings/loading.tsx.
export default function BusinessLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}
