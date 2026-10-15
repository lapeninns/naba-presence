import { MembersSkeleton } from "@/components/settings/team-list"
import { cardClassName } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * The shape of Team while it loads: the title with its Invite action, the
 * members (the same skeleton the list shows while it fetches), the
 * invitations and the roles card. A plain `div`, not
 * `PageFrame`, for the reason `app/(dashboard)/loading.tsx` gives: the page
 * that streams in owns the one `<main>`. Same paddings so nothing shifts.
 */
export default function TeamLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="mx-auto flex w-full max-w-(--np-page-default-width) flex-col gap-(--np-gap-section) px-5 py-6 md:px-(--np-page-pad-x) md:py-(--np-page-pad-y)"
    >
      <span className="sr-only">Loading your team</span>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-28 rounded-sm" />
          <Skeleton className="h-4 w-80 max-w-full rounded-sm" />
        </div>
        <Skeleton className="h-(--np-control-h) w-40 rounded-(--np-radius-control)" />
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-5 w-24 rounded-sm" />
          <Skeleton className="h-3.5 w-64 max-w-full rounded-sm" />
        </div>
        <MembersSkeleton />
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-5 w-28 rounded-sm" />
          <Skeleton className="h-3.5 w-64 max-w-full rounded-sm" />
        </div>
        <div className={cardClassName({ className: "flex flex-col" })}>
          <div className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-7 shrink-0 rounded-full" />
            <Skeleton className="h-4 w-48 max-w-full rounded-sm" />
            <Skeleton className="ml-auto h-5 w-16 rounded-sm" />
          </div>
        </div>
      </div>
      <Skeleton className="h-56 rounded-(--np-radius-card)" />
    </div>
  )
}
