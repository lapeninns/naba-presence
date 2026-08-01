"use client"

import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"

function EmptyState({
  kind,
  onClear,
}: {
  kind: "no-data" | "filtered" | "disconnected"
  onClear?: () => void
}) {
  if (kind === "disconnected") {
    return (
      <Empty
        title="Google is not connected"
        description="Reconnect Google to sync and reply to your reviews."
      />
    )
  }
  if (kind === "filtered") {
    return (
      <Empty
        title="No reviews match these filters"
        description="Try widening or clearing your filters."
        action={
          onClear ? (
            <Button variant="outline" size="sm" onClick={onClear}>
              Clear filters
            </Button>
          ) : undefined
        }
      />
    )
  }
  return (
    <Empty
      title="No reviews yet"
      description="New Google reviews will appear here as they arrive."
    />
  )
}

export { EmptyState }
