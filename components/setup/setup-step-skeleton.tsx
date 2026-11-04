import { Skeleton } from "@/components/ui/skeleton"
import { cardClassName } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/**
 * The setup step's shape while it loads, shared by the route's `loading.tsx`
 * and the wizard's own pending state so the two cannot drift: the step rail
 * beside the step card from `@3xl` of the named `setup` container, and below
 * that the "Step N of M" line, its progress bar and the uncarded step, as the
 * wizard draws them. The loading words are a separate sr-only status, so the
 * bars themselves are not read out.
 */
function SetupStepSkeleton({
  label,
  steps,
}: {
  label: string
  /** Rail rows: the flow's length when known. */
  steps: number
}) {
  return (
    <div className="@container/setup" aria-busy="true">
      <p role="status" className="sr-only">
        {label}
      </p>
      <div className="flex flex-col items-start gap-6 @3xl/setup:flex-row">
        <div aria-hidden className="hidden w-55 shrink-0 flex-col gap-2 @3xl/setup:flex">
          {Array.from({ length: steps }, (_, index) => (
            <Skeleton key={index} className="h-8" />
          ))}
        </div>
        <div
          aria-hidden
          className={cardClassName({
            pad: true,
            className: cn(
              "flex w-full min-w-0 flex-1 flex-col gap-4",
              "max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:p-0"
            ),
          })}
        >
          <div className="flex flex-col gap-2 border-b border-line-subtle pb-4">
            <div className="mb-2 flex flex-col gap-2 @3xl/setup:hidden">
              <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-8 w-24" />
              </div>
              <Skeleton className="h-1.5 w-full rounded-full" />
            </div>
            <Skeleton className="hidden h-3.5 w-24 @3xl/setup:block" />
            <Skeleton className="h-6 w-56 max-w-full" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <Skeleton className="h-32 w-full rounded-(--np-radius-card)" />
        </div>
      </div>
    </div>
  )
}

export { SetupStepSkeleton }
