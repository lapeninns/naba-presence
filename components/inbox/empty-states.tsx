"use client"

import {
  CloudDownloadIcon,
  InboxIcon,
  SearchXIcon,
  TriangleAlertIcon,
  UnplugIcon,
} from "lucide-react"

import Link from "next/link"

import { Button, buttonVariants } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { formatRelativeTime } from "@/lib/format/date"
import type { EmptyReason } from "@/lib/inbox/empty-reason"

type Content = {
  icon: typeof InboxIcon
  title: string
  description: string
}

/**
 * One sentence per reason, and every sentence has to be true of the facts that
 * selected it (lib/inbox/empty-reason.ts).
 *
 * All of this used to be a single entry: "No reviews yet. New Google reviews
 * will appear here as they arrive." It was shown whether Google had never been
 * asked, an import was mid-flight, an import had failed, or there genuinely
 * were none — and the second sentence promised an arrival that cannot happen
 * until an import runs.
 */
function content(reason: EmptyReason, counts: EmptyCounts): Content {
  switch (reason) {
    case "filtered":
      return {
        icon: SearchXIcon,
        title: "No reviews match these filters",
        description: "Try widening or clearing your filters.",
      }
    // This state carries the whole message, headline and action included. It
    // used to defer to the shell's ReconnectBanner, but that banner is now
    // client-scoped and the inbox is organisation-wide, so on this screen
    // there is nothing else to defer to.
    case "disconnected":
      return {
        icon: UnplugIcon,
        title: "Google is not connected",
        description: "Reconnect Google to sync and reply to your reviews.",
      }
    case "not_connected":
      return {
        icon: UnplugIcon,
        title: "No locations are linked to Google yet",
        description:
          "Link a client's locations to Google and their reviews will be imported here.",
      }
    // Deliberately true of a queued import as well as a running one: the
    // counts this reads cannot tell the two apart. "Waiting on Google" holds
    // either way; "importing right now" would not.
    case "importing":
      return {
        icon: CloudDownloadIcon,
        title: "Reviews are still coming in",
        description:
          counts.running === 1
            ? "One location is waiting on Google. Reviews appear here as they land, which can take a few minutes."
            : `${counts.running} locations are waiting on Google. Reviews appear here as they land, which can take a few minutes.`,
      }
    case "import_failed":
      return {
        icon: TriangleAlertIcon,
        title: "Some locations could not be imported",
        description:
          counts.failed === 1
            ? "One location's import did not finish, so its reviews are missing. Check its connection in Settings."
            : `${counts.failed} locations' imports did not finish, so their reviews are missing. Check their connections in Settings.`,
      }
    case "never_imported":
      return {
        icon: CloudDownloadIcon,
        title: "No reviews have been imported yet",
        description:
          "These locations are linked, but no import has run for them. Start one from Settings.",
      }
    // The only branch allowed to say there are none — and it still says when
    // Google was last asked rather than asserting a fact about Google now.
    case "checked":
      return {
        icon: InboxIcon,
        title: "No reviews yet",
        description: counts.lastSyncAt
          ? `Google had none for these locations when we last checked, ${formatRelativeTime(counts.lastSyncAt)}.`
          : "Google had none for these locations when we last checked.",
      }
    case "unknown":
      return {
        icon: InboxIcon,
        title: "Nothing to show here",
        description: "No reviews are in this view.",
      }
  }
}

export type EmptyCounts = {
  running: number
  failed: number
  succeeded: number
  notStarted: number
  lastSyncAt: string | null
}

const NO_COUNTS: EmptyCounts = {
  running: 0,
  failed: 0,
  succeeded: 0,
  notStarted: 0,
  lastSyncAt: null,
}

function EmptyState({
  reason,
  counts = NO_COUNTS,
  onClear,
}: {
  reason: EmptyReason
  counts?: EmptyCounts
  onClear?: () => void
}) {
  const { icon: Icon, title, description } = content(reason, counts)
  const action =
    reason === "filtered" && onClear ? (
      <Button variant="outline" size="sm" onClick={onClear}>
        Clear filters
      </Button>
    ) : reason === "disconnected" ||
      reason === "import_failed" ||
      reason === "never_imported" ||
      reason === "not_connected" ? (
      <Link
        href="/settings/connections"
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        Manage connection
      </Link>
    ) : undefined

  return (
    <Empty
      title={title}
      description={description}
      className="border-none"
      action={action}
    >
      <span className="mb-1 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon aria-hidden className="size-5" />
      </span>
    </Empty>
  )
}

export { EmptyState }
