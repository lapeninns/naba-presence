"use client"

import { InboxIcon, SearchXIcon, UnplugIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"

const KIND_CONTENT = {
  disconnected: {
    icon: UnplugIcon,
    title: "Google is not connected",
    description: "Reconnect Google to sync and reply to your reviews.",
  },
  filtered: {
    icon: SearchXIcon,
    title: "No reviews match these filters",
    description: "Try widening or clearing your filters.",
  },
  "no-data": {
    icon: InboxIcon,
    title: "No reviews yet",
    description: "New Google reviews will appear here as they arrive.",
  },
} as const

function EmptyState({
  kind,
  onClear,
}: {
  kind: "no-data" | "filtered" | "disconnected"
  onClear?: () => void
}) {
  const { icon: Icon, title, description } = KIND_CONTENT[kind]
  return (
    <Empty
      title={title}
      description={description}
      className="border-none"
      action={
        kind === "filtered" && onClear ? (
          <Button variant="outline" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        ) : undefined
      }
    >
      <span className="mb-1 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon aria-hidden className="size-5" />
      </span>
    </Empty>
  )
}

export { EmptyState }
