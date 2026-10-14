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
  canManageClients: boolean,
  business: boolean
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
        description: "Reconnect Google to sync and reply to your reviews.",
      }
    case "not_connected":
      return {
        title: "No locations are linked to Google yet.",
        description: business
          ? "Link your locations to Google and their reviews will be imported here."
          : "Link a client's locations to Google and their reviews will be imported here.",
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
 * primitive, with a tinted mark or, in its `illustration` slot, a line
 * drawing; the title (an h2, the primitive's `text-title` at weight 500,
 * like Notion Mail's "All caught up!"), one muted sentence and at most one
 * action. Used for the pane that has nothing selected and for every reason
 * a queue can be empty. `placement="page"` is for a state that fills its
 * pane (it sits at about 35% of the height).
 */
function Statement({
  title,
  description,
  action,
  icon = <InboxIcon />,
  illustration,
  tone = "neutral",
  placement,
  className,
}: {
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  icon?: React.ReactNode
  illustration?: React.ReactNode
  tone?: "neutral" | "ok" | "bad"
  placement?: "inline" | "page"
  className?: string
}) {
  return (
    <Empty
      title={title}
      description={description}
      action={action}
      icon={illustration ? null : icon}
      illustration={illustration || undefined}
      tone={tone}
      titleAs="h2"
      placement={placement}
      className={className}
    />
  )
}

/**
 * Line art for the empty list (Notion Mail's inbox-zero drawing, in our own
 * shapes), for the `Empty` illustration slot: drawn on a 112 grid with a
 * 1.5 stroke in `currentColor`, so the slot's ink, size and aria-hidden
 * apply. Only the danger mark carries a colour of its own. Nothing
 * animates, so reduced motion has nothing to stop (the hourglass is a still
 * drawing, never a spinner).
 */
function Art({ children }: { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox="0 0 112 112"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

/** The tray every inbox drawing starts from. */
const TRAY = (
  <>
    <path d="M18 66 30 38h52l12 28v18a4 4 0 0 1-4 4H22a4 4 0 0 1-4-4Z" />
    <path d="M18 66h22l4 8h24l4-8h22" />
  </>
)

/**
 * The danger mark for a reason that is a problem (`bad`): an exclamation in
 * a circle, so the state is not carried by the red alone.
 */
const ALERT_MARK = (
  <g className="text-danger-ink">
    <circle cx="88" cy="24" r="10" />
    <path d="M88 19v6" />
    <path d="M88 29.5h.01" />
  </g>
)

/** Caught up: the tray with a tick in it. */
const TRAY_TICK = (
  <Art>
    {TRAY}
    <path d="m46 54 7 7 13-14" />
  </Art>
)

/** Nothing yet: the empty tray, with a little air above it. */
const TRAY_EMPTY = (
  <Art>
    {TRAY}
    <path d="M46 26v-6M56 24V14M66 26v-6" />
  </Art>
)

/** No clients or locations: a shopfront. */
const STOREFRONT = (
  <Art>
    <path d="M24 44 32 26h48l8 18" />
    <path d="M24 44a8 8 0 0 0 16 0 8 8 0 0 0 16 0 8 8 0 0 0 16 0 8 8 0 0 0 16 0" />
    <path d="M28 52v36h56V52" />
    <path d="M48 88V68h16v20" />
    <path d="M70 62h8v10h-8Z" />
    <path d="M16 88h80" />
  </Art>
)

/** Not connected: a plug pulled out of its socket. */
const UNPLUGGED = (
  <Art>
    <path d="M8 58h14" />
    <rect x="22" y="48" width="20" height="20" rx="4" />
    <path d="M42 53h8M42 63h8" />
    <rect x="64" y="46" width="24" height="24" rx="5" />
    <path d="M72 55v6M80 55v6" />
    <path d="M88 58h16" />
    <path d="m55 44 3-6M57 58h2M55 72l3 6" />
  </Art>
)

/** Disconnected: the pulled plug, with the danger mark. */
const UNPLUGGED_ALERT = (
  <Art>
    <path d="M8 66h14" />
    <rect x="22" y="56" width="20" height="20" rx="4" />
    <path d="M42 61h8M42 71h8" />
    <rect x="60" y="54" width="24" height="24" rx="5" />
    <path d="M68 63v6M76 63v6" />
    <path d="M84 66h20" />
    {ALERT_MARK}
  </Art>
)

/** Still coming in: an hourglass, part run. */
const HOURGLASS = (
  <Art>
    <path d="M38 18h36M38 94h36" />
    <path d="M42 18c0 20 14 26 14 38S42 74 42 94" />
    <path d="M70 18c0 20-14 26-14 38s14 18 14 38" />
    <path d="M48 30h16M48 88c2-6 6-8 8-8s6 2 8 8Z" />
  </Art>
)

/** An import that did not finish: the tray, with the danger mark. */
const TRAY_ALERT = (
  <Art>
    {TRAY}
    <path d="M44 52h24" />
    {ALERT_MARK}
  </Art>
)

/**
 * The drawing for each reason. `filtered` and `unknown` have none: a
 * search or filter that matched nothing gets the small mark and one line,
 * as Notion Mail's search does, and "nothing to show" is not an event to
 * illustrate.
 */
function illustrationFor(
  reason: EmptyReason,
  queue: Queue | undefined
): React.ReactNode {
  switch (reason) {
    case "queue_empty":
      return queue && visibleQueue(queue) === "done" ? TRAY_EMPTY : TRAY_TICK
    case "checked":
      return TRAY_EMPTY
    case "no_clients":
      return STOREFRONT
    case "disconnected":
      return UNPLUGGED_ALERT
    case "not_connected":
    case "never_imported":
      return UNPLUGGED
    case "importing":
      return HOURGLASS
    case "import_failed":
      return TRAY_ALERT
    case "filtered":
    case "unknown":
      return null
  }
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
  placement,
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
  /** `page` when the state fills the list pane (see `Statement`). */
  placement?: "inline" | "page"
}) {
  const business = useWorkspaceMode() === "business"
  const { title, description } = content(
    reason,
    counts,
    queue,
    canManageClients,
    business
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
      <Link
        href={business ? "/setup" : "/clients/new"}
        className={cn(buttonVariants())}
      >
        {business ? "Link your listings" : "Add a client"}
      </Link>
    ) : reason === "disconnected" ? (
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
      illustration={illustrationFor(reason, queue)}
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
