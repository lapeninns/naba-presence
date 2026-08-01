"use client"

import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { describeActionError, isNotLinkedError } from "@/lib/locations/action-errors"

export function TabLoading() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}

export function TabError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (isNotLinkedError(error)) {
    return (
      <Empty
        title="This location isn’t linked to Google yet"
        description="Link it to Google Business Profile to manage its details, hours, photos and more here."
      />
    )
  }
  return (
    <Empty
      title="We couldn’t load this section"
      description={describeActionError(error)}
      action={
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      }
    />
  )
}
