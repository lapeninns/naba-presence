"use client"

import { Empty } from "@/components/ui/empty"
import { QueryError, QueryPending } from "@/components/ui/query-states"
import { isNotLinkedError } from "@/lib/errors/action-errors"

export function TabLoading() {
  return <QueryPending />
}

export function TabError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  // No Google link is a distinct state the tab can act on, not a failure.
  if (isNotLinkedError(error)) {
    return (
      <Empty
        title="This location isn’t linked to Google yet"
        description="Link it to Google Business Profile to manage its details, hours, photos and more here."
      />
    )
  }
  return (
    <QueryError
      title="We couldn’t load this section"
      cause={error}
      onRetry={onRetry}
    />
  )
}
