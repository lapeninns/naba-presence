"use client"

import { InboxIcon, SearchXIcon, UnplugIcon } from "lucide-react"

import Link from "next/link"

import { Button, buttonVariants } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"

const KIND_CONTENT = {
  // This state carries the whole message, headline and action included.
  // It used to defer both to the shell's ReconnectBanner on the grounds that
  // the two always rendered together — but that banner is now client-scoped
  // (it names the affected client and offers that client's reconnect), and
  // the inbox is organisation-wide, so on this screen there is nothing else
  // to defer to. An empty list saying only "No reviews to show" would leave
  // an operator with no reason and no way out.
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
        ) : kind === "disconnected" ? (
          <Link
            href="/settings/connections"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Manage connection
          </Link>
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
