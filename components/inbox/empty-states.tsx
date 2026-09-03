"use client"

import { InboxIcon, SearchXIcon, UnplugIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"

const KIND_CONTENT = {
  // InboxView picks this kind from the same `health.status === "disconnected"`
  // that puts the shell's ReconnectBanner on screen
  // (components/app-shell/reconnect-banner.tsx), so the two ALWAYS render
  // together. The banner owns the "Google is not connected" headline and the
  // Manage connection CTA; repeating both here told the operator the same
  // thing twice and offered the same link twice on one screen. This state
  // says only what it alone knows: why the list is empty.
  disconnected: {
    icon: UnplugIcon,
    title: "No reviews to show",
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
