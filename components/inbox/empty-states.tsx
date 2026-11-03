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
import { RelativeTime } from "@/components/ui/relative-time"
import { Empty } from "@/components/ui/empty"
import { formatNumber } from "@/lib/format"
import type { EmptyReason } from "@/lib/inbox/empty-reason"
import { CLEAR_FILTERS_LABEL } from "@/lib/inbox/filter-labels"
import { visibleQueue, type Queue } from "@/lib/inbox/url-state"
import { cn } from "@/lib/utils"
import { useWorkspaceMode } from "@/lib/workspace/mode"

type Content = {
  title: string
  description: React.ReactNode
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
  // The description when another queue has work: the button under it says
  // where. Without one, see `needsReplyEmpty`.
  needs_reply: {
    title: "Nothing needs a reply.",
    description: "Every review in this queue has been dealt with.",
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

/**
 * What a filtered list was narrowed by, for an empty state that says what
 * matched nothing and where. Built by the inbox beside the empty-state facts.
 */
export type FilteredFacts = {
  /** The search in force, if any. */
  search?: string
  /** The search is the only narrowing (a sort hides nothing, so it is not one). */
  searchOnly: boolean
  /** The queue searched, by name; omitted for "All reviews". */
  queueLabel?: string
  /** The server's count for that queue in scope, filters aside. */
  queueTotal?: number
}

/** "Needs reply has 2 reviews", or nothing when the count is not known. */
function queueHas(filtered: FilteredFacts): string | null {
  const { queueLabel, queueTotal } = filtered
  if (!queueLabel || !queueTotal) return null
  return `${queueLabel} has ${formatNumber(queueTotal)} ${queueTotal === 1 ? "review" : "reviews"}`
}

function filteredContent(filtered: FilteredFacts | undefined): Content {
  // A search alone gets its own words: it names what was looked for and
  // where, since a search runs inside the queue on screen and a review in
  // another queue is not "missing".
  if (filtered?.searchOnly && filtered.search) {
    return {
      title: `No reviews match “${filtered.search}”`,
      description: filtered.queueLabel
        ? `Nothing in ${filtered.queueLabel} matches. Try other words, or choose another queue above. Your search stays.`
        : "Try other words.",
    }
  }
  const has = filtered ? queueHas(filtered) : null
  if (filtered) {
    return {
      title: "No reviews match these filters.",
      description: has
        ? `${has}, but none match. Remove a filter above, or clear them all.`
        : "Remove a filter above, or clear them all.",
    }
  }
  return {
    title: "No reviews match these filters.",
    description: "Widen or clear them to see the rest of the queue.",
  }
}

/**
 * An empty Needs reply. An approver with replies parked for them is told so
 * (the inbox's count includes them); otherwise it says whether another queue
 * has work, which the button under it names.
 */
function needsReplyEmpty(
  hasNext: boolean,
  approvalsWaiting: number | undefined
): Content {
  if (approvalsWaiting && approvalsWaiting > 0) {
    return {
      title: QUEUE_EMPTY.needs_reply.title,
      description: `${formatNumber(approvalsWaiting)} ${
        approvalsWaiting === 1 ? "reply is" : "replies are"
      } waiting for your approval.`,
    }
  }
  return hasNext
    ? QUEUE_EMPTY.needs_reply
    : {
        title: QUEUE_EMPTY.needs_reply.title,
        description:
          "You’re all caught up. Every review in this queue has been dealt with.",
      }
}

function content(
  reason: EmptyReason,
  counts: EmptyCounts,
  queue: Queue | undefined,
  canManageClients: boolean,
  business: boolean,
  extra: {
    hasNext: boolean
    approvalsWaiting?: number
    filtered?: FilteredFacts
  }
): Content {
  switch (reason) {
    case "filtered":
      return filteredContent(extra.filtered)
    case "queue_empty": {
      const shown = (queue && visibleQueue(queue)) || "needs_reply"
      if (shown === "needs_reply")
        return needsReplyEmpty(extra.hasNext, extra.approvalsWaiting)
      return QUEUE_EMPTY[shown] ?? QUEUE_EMPTY.needs_reply
    }
    // The first run. Only owners and admins can add a client, so everyone
    // else is told who can rather than sent to a page that would refuse them.
    case "no_clients":
      // A business has one home client behind the scenes, so "no clients"
      // reads as "no listings linked yet".
      if (business)
        return canManageClients
          ? {
              title: "No locations yet.",
              description:
                "Link your Google listings and their reviews arrive here.",
            }
          : {
              title: "No locations yet.",
              description:
                "Ask an owner or admin to link your Google listings. Their reviews will arrive here.",
            }
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
        description: canManageClients
          ? "Reconnect Google to sync and reply to your reviews."
          : "Ask an owner or admin to reconnect Google so you can sync and reply to your reviews.",
      }
    case "not_connected":
      return {
        title: "No locations are linked to Google yet.",
        description: canManageClients
          ? business
            ? "Link your locations to Google and their reviews will be imported here."
            : "Link a client's locations to Google and their reviews will be imported here."
          : "Ask an owner or admin to link them to Google. Their reviews will be imported here.",
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
        description: canManageClients
          ? counts.failed === 1
            ? "One location's import did not finish, so its reviews are missing. Check its connection in Settings."
            : `${counts.failed} locations' imports did not finish, so their reviews are missing. Check their connections in Settings.`
          : counts.failed === 1
            ? "One location's import did not finish, so its reviews are missing. Ask an owner or admin to check its Google connection."
            : `${counts.failed} locations' imports did not finish, so their reviews are missing. Ask an owner or admin to check their Google connections.`,
      }
    case "never_imported":
      return {
        title: "No reviews have been imported yet.",
        description: canManageClients
          ? "These locations are linked, but no import has run for them. Start one from Settings."
          : "These locations are linked, but no import has run for them. Ask an owner or admin to start one.",
      }
    // The only branch allowed to say there are none — and it still says when
    // Google was last asked rather than asserting a fact about Google now.
    case "checked":
      return {
        title: "No reviews yet.",
        description: counts.lastSyncAt ? (
          <>
            Google had none for these locations when we last checked,{" "}
            <RelativeTime iso={counts.lastSyncAt} />.
          </>
        ) : (
          "Google had none for these locations when we last checked."
        ),
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
 * A message in place of content (reference `.empty`): the `Empty`
 * primitive, with its 20px line glyph in the tone's ink; the title (an h2,
 * the primitive's `text-title`, like Notion Mail's "All caught up!"), one
 * muted sentence and at most one action. Used for the pane that has nothing selected and for every reason
 * a queue can be empty. `placement="page"` is for a state that fills its
 * pane (it sits at about 35% of the height).
 */
function Statement({
  title,
  description,
  action,
  icon = <InboxIcon />,
  tone = "neutral",
  placement,
  className,
}: {
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  icon?: React.ReactNode
  tone?: "neutral" | "ok" | "bad"
  placement?: "inline" | "page"
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
      placement={placement}
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
  approvalsWaiting,
  filtered,
  canManageClients = false,
  placement,
}: {
  reason: EmptyReason
  counts?: EmptyCounts
  onClear?: () => void
  /** The queue on screen, for the empty queue's own wording. */
  queue?: Queue
  /** The next queue with work in it, offered from an empty one. */
  nextQueue?: { label: string; count: number; onSelect: () => void }
  /**
   * Replies waiting for this person's approval, from an empty Needs reply,
   * with the way to them. Said and offered in place of `nextQueue`.
   */
  approvalsWaiting?: { count: number; onSelect: () => void }
  /** What a filtered list was narrowed by (see `FilteredFacts`). */
  filtered?: FilteredFacts
  /** Owners and admins, who can add a client and manage Google connections. */
  canManageClients?: boolean
  /** `page` when the state fills the list pane (see `Statement`). */
  placement?: "inline" | "page"
}) {
  const business = useWorkspaceMode() === "business"
  const approvals =
    reason === "queue_empty" &&
    queue &&
    visibleQueue(queue) === "needs_reply" &&
    approvalsWaiting &&
    approvalsWaiting.count > 0
      ? approvalsWaiting
      : undefined
  const { title, description } = content(
    reason,
    counts,
    queue,
    canManageClients,
    business,
    {
      hasNext: Boolean(nextQueue),
      approvalsWaiting: approvals?.count,
      filtered,
    }
  )
  // A connection problem. Members and viewers are not sent to a page that
  // would refuse them (/settings/connections is owners and admins only): the
  // sentence above says who can fix it, and there is no button.
  const connectionFixFor =
    reason === "disconnected" ||
    reason === "import_failed" ||
    reason === "never_imported" ||
    reason === "not_connected"
  const action =
    reason === "filtered" && onClear ? (
      // One name for clearing everything, as the chips and the Filters sheet
      // say it; a search on its own is cleared by name.
      <Button variant="secondary" onClick={onClear}>
        {filtered?.searchOnly && filtered.search
          ? "Clear search"
          : CLEAR_FILTERS_LABEL}
      </Button>
    ) : approvals ? (
      <Button variant="secondary" onClick={approvals.onSelect}>
        Review your approvals ({formatNumber(approvals.count)})
      </Button>
    ) : reason === "queue_empty" && nextQueue ? (
      <Button variant="secondary" onClick={nextQueue.onSelect}>
        Go to {nextQueue.label} ({formatNumber(nextQueue.count)})
      </Button>
    ) : reason === "no_clients" && canManageClients ? (
      <Link
        href={business ? "/setup" : "/clients/new"}
        className={cn(buttonVariants())}
      >
        {business ? "Link your listings" : "Add a client"}
      </Link>
    ) : connectionFixFor && !canManageClients ? undefined : reason ===
      "disconnected" ? (
      // Says what the page it opens is for here. Same place as below.
      <Link
        href="/settings/connections"
        className={cn(buttonVariants({ variant: "secondary" }))}
      >
        Reconnect Google
      </Link>
    ) : reason === "import_failed" ||
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
      placement={placement}
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
