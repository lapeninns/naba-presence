import { Skeleton } from "@/components/ui/skeleton"

// Plain `div` — the <main> comes from (business)/layout.tsx and the sub-nav
// from profile/layout.tsx. See app/(dashboard)/loading.tsx for the rule.
export default function ProfileLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}
