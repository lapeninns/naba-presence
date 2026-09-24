"use client"

import Link from "next/link"

import {
  CheckIcon,
  CircleAlertIcon,
  FilterIcon,
  InboxIcon,
  LoaderIcon,
  PlugIcon,
  UnlinkIcon,
} from "lucide-react"

import { Button, buttonVariants } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { formatNumber } from "@/lib/format"
import { formatRelativeTime } from "@/lib/format/date"
import type { EmptyReason } from "@/lib/inbox/empty-reason"
import { visibleQueue, type Queue } from "@/lib/inbox/url-state"
import { cn } from "@/lib/utils"

type Content = {
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
/**
 * An empty queue, in that queue's own words. "Nothing needs a reply" over an
 * empty Failed queue answered a question nobody had asked there.
 */
const QUEUE_EMPTY: Record<string, Content> = {
  needs_reply: {
    title: "Nothing needs a reply.",
    description:
      "Every review in this queue has been dealt with. Choose another queue above to keep working.",
  },
  approval: {
    title: "Nothing is waiting for approval.",
    description: "Replies submitted for approval appear here.",
  },
  publishing: {
    title: "Nothing is on its way to Google.",
    description: "Replies sit here between Publish and Google confirming them.",
  },
  failed: {
    title: "No failed publishes.",
    description: "Every reply sent to Google got there.",
  },
  done: {
    title: "Nothing published yet.",
    description: "Replies appear here once Google confirms them.",
  },
}

function content(
  reason: EmptyReason,
  counts: EmptyCounts,
  queue: Queue | undefined,
  canManageClients: boolean
): Content {
  switch (reason) {
    case "filtered":
      return {
        title: "No reviews match these filters.",
        description: "Widen or clear them to see the rest of the queue.",
      }
    case "queue_empty":
      return (
        QUEUE_EMPTY[(queue && visibleQueue(queue)) || "needs_reply"] ??
        QUEUE_EMPTY.needs_reply
      )
    // The first run. Only owners and admins can add a client, so everyone
    // else is told who can rather than sent to a page that would refuse them.
    case "no_clients":
      return canManageClients
        ? {
            title: "No clients yet.",
            description:
              "Add your first client and link its Google listings. Their reviews arrive here.",
          }
        : {
            title: "No clients yet.",
            description:
              "Ask an owner or admin to add a client and link its Google listings. Their reviews will arrive here.",
          }
    // This state carries the whole message, headline and action included. It
    // used to defer to the shell's ReconnectBanner, but that banner is now
    // client-scoped and the inbox is organisation-wide, so on this screen
    // there is nothing else to defer to.
    case "disconnected":
      return {
        title: "Google is not connected.",
        description: "Reconnect Google to sync and reply to your reviews.",
      }
    case "not_connected":
      return {
        title: "No locations are linked to Google yet.",
        description:
          "Link a client's locations to Google and their reviews will be imported here.",
      }
    // Deliberately true of a queued import as well as a running one: the
    // counts this reads cannot tell the two apart. "Waiting on Google" holds
    // either way; "importing right now" would not.
    case "importing":
      return {
        title: "Reviews are still coming in.",
        description:
          counts.running === 1
            ? "One location is waiting on Google. Reviews appear here as they land, which can take a few minutes."
            : `${counts.running} locations are waiting on Google. Reviews appear here as they land, which can take a few minutes.`,
      }
    case "import_failed":
      return {
        title: "Some locations could not be imported.",
        description:
          counts.failed === 1
            ? "One location's import did not finish, so its reviews are missing. Check its connection in Settings."
            : `${counts.failed} locations' imports did not finish, so their reviews are missing. Check their connections in Settings.`,
      }
    case "never_imported":
      return {
        title: "No reviews have been imported yet.",
        description:
          "These locations are linked, but no import has run for them. Start one from Settings.",
      }
    // The only branch allowed to say there are none — and it still says when
    // Google was last asked rather than asserting a fact about Google now.
    case "checked":
      return {
        title: "No reviews yet.",
        description: counts.lastSyncAt
          ? `Google had none for these locations when we last checked, ${formatRelativeTime(counts.lastSyncAt)}.`
          : "Google had none for these locations when we last checked.",
      }
    case "unknown":
      return {
        title: "Nothing to show here.",
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

/**
 * A message in place of content (reference `.empty`): a tinted mark, the
 * title, one muted sentence and at most one action. Used for the pane that
 * has nothing selected and for every reason a queue can be empty.
 */
function Statement({
  title,
  description,
  action,
  icon = <InboxIcon />,
  tone = "neutral",
  className,
}: {
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  icon?: React.ReactNode
  tone?: "neutral" | "ok" | "bad"
  className?: string
}) {
  return (
    <Empty
      title={title}
      description={description}
      action={action}
      icon={icon}
      tone={tone}
      titleAs="h2"
      className={className}
    />
  )
}

const ICONS: Record<EmptyReason, React.ReactNode> = {
  filtered: <FilterIcon />,
  queue_empty: <CheckIcon />,
  no_clients: <InboxIcon />,
  disconnected: <UnlinkIcon />,
  not_connected: <PlugIcon />,
  importing: <LoaderIcon />,
  import_failed: <CircleAlertIcon />,
  never_imported: <PlugIcon />,
  checked: <InboxIcon />,
  unknown: <InboxIcon />,
}

const TONES: Partial<Record<EmptyReason, "ok" | "bad">> = {
  queue_empty: "ok",
  disconnected: "bad",
  import_failed: "bad",
}

/**
 * The list's empty state: the reason, said plainly, and the one action that
 * changes it.
 */
function EmptyState({
  reason,
  counts = NO_COUNTS,
  onClear,
  queue,
  nextQueue,
  canManageClients = false,
}: {
  reason: EmptyReason
  counts?: EmptyCounts
  onClear?: () => void
  /** The queue on screen, for the empty queue's own wording. */
  queue?: Queue
  /** The next queue with work in it, offered from an empty one. */
  nextQueue?: { label: string; count: number; onSelect: () => void }
  /** Owners and admins, who can add a client. */
  canManageClients?: boolean
}) {
  const { title, description } = content(
    reason,
    counts,
    queue,
    canManageClients
  )
  const action =
    reason === "filtered" && onClear ? (
      <Button variant="secondary" onClick={onClear}>
        Clear filters
      </Button>
    ) : reason === "queue_empty" && nextQueue ? (
      <Button variant="secondary" onClick={nextQueue.onSelect}>
        Go to {nextQueue.label} ({formatNumber(nextQueue.count)})
      </Button>
    ) : reason === "no_clients" && canManageClients ? (
      <Link href="/clients/new" className={cn(buttonVariants())}>
        Add a client
      </Link>
    ) : reason === "disconnected" ||
      reason === "import_failed" ||
      reason === "never_imported" ||
      reason === "not_connected" ? (
      <Link
        href="/settings/connections"
        className={cn(buttonVariants({ variant: "secondary" }))}
      >
        Manage connection
      </Link>
    ) : undefined

  return (
    <Statement
      title={title}
      description={description}
      action={action}
      icon={ICONS[reason]}
      tone={
        // An empty Done queue is not good news; every other empty queue is.
        reason === "queue_empty" && queue && visibleQueue(queue) === "done"
          ? "neutral"
          : (TONES[reason] ?? "neutral")
      }
    />
  )
}

export { EmptyState, Statement }
