import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { Skeleton } from "@/components/ui/skeleton"

export default function LocationsLoading() {
  return (
    <PageFrame width="wide">
      <PageHeader title="Locations" description="Every location in this organisation and the state of its Google link." />
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    </PageFrame>
  )
}
