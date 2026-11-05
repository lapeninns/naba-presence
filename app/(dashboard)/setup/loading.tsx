import { PageFrame } from "@/components/app-shell/page-frame"
import { SetupStepSkeleton } from "@/components/setup/setup-step-skeleton"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * The shape of setup while it streams: the title block, then the same step
 * skeleton the wizard shows while its data loads (`SetupStepSkeleton`), so
 * the rail and the phone stepper switch at one width. The role check has not
 * run yet, so the words stay neutral. `PageFrame` is a plain `div`: the shell
 * owns the one `<main>`.
 */
export default function Loading() {
  return (
    <PageFrame>
      <div aria-hidden className="flex flex-col gap-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-8 w-56 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <SetupStepSkeleton label="Loading setup" steps={9} />
    </PageFrame>
  )
}
