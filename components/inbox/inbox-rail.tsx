"use client"

import { ChevronDown, TriangleAlert } from "lucide-react"
import * as React from "react"

import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import { healthTone, type ClientHealth } from "@/lib/clients/health"
import {
  REVIEW_QUEUE_LABELS,
  type ReviewCounts,
  type ReviewQueue,
} from "@/lib/contracts/reviews"
import type { InboxState } from "@/lib/inbox/url-state"
import { SAVED_VIEWS } from "@/lib/inbox/saved-views"
import { cn } from "@/lib/utils"

/** The queues worth their own row. `all` is reached by clearing, not listed. */
const QUEUE_ORDER: ReviewQueue[] = [
  "needs_reply",
  "awaiting_my_approval",
  "awaiting_others",
  "publishing",
  "failed",
  "done",
]

/** Queues that are noise when empty; a client with no failures shows no row. */
const HIDE_WHEN_EMPTY: ReviewQueue[] = ["awaiting_others", "publishing", "failed"]

export type RailClient = {
  id: string
  name: string
  health: ClientHealth
}

/**
 * The inbox's left rail: what needs doing, and for whom.
 *
 * Replaces a tab strip that could only express workflow status. An agency's
 * first question is not "how many reviews are awaiting approval" but "which
 * client is behind", so the queues appear twice: once across everything, and
 * once per client.
 */
function InboxRail({
  state,
  counts,
  countsPending,
  clients,
  onQueueChange,
  onSelectView,
  onSelectClientQueue,
}: {
  state: InboxState
  counts: ReviewCounts | undefined
  countsPending: boolean
  clients: RailClient[]
  onQueueChange: (queue: ReviewQueue) => void
  onSelectView: (slug: string) => void
  onSelectClientQueue: (clientId: string, queue: ReviewQueue) => void
}) {
  const groups = counts?.groups ?? []
  const clientById = new Map(clients.map((client) => [client.id, client]))

  return (
    <nav
      aria-label="Review queues"
      className="flex w-full flex-col gap-5 overflow-y-auto p-3"
    >
      <div className="flex flex-col gap-0.5">
        <RailHeading>Everything</RailHeading>
        {QUEUE_ORDER.map((queue) => {
          const count = counts?.byQueue?.[queue] ?? 0
          if (HIDE_WHEN_EMPTY.includes(queue) && count === 0 && !countsPending) {
            return null
          }
          return (
            <RailRow
              key={queue}
              label={REVIEW_QUEUE_LABELS[queue]}
              count={count}
              countsPending={countsPending}
              active={state.queue === queue && !state.clientId}
              onSelect={() => onQueueChange(queue)}
            />
          )
        })}
      </div>

      {groups.length > 1 ? (
        <div className="flex flex-col gap-2">
          <RailHeading>By client</RailHeading>
          {groups.map((group) => {
            const client = group.clientId ? clientById.get(group.clientId) : undefined
            const needsReply = group.byQueue.needs_reply ?? 0
            const mine = group.byQueue.awaiting_my_approval ?? 0
            const failed = group.byQueue.failed ?? 0
            return (
              <ClientGroup
                key={group.clientId ?? "unassigned"}
                name={group.clientName}
                health={client?.health}
                selected={state.clientId === group.clientId}
                rows={[
                  ["needs_reply" as const, needsReply],
                  ["awaiting_my_approval" as const, mine],
                  ["failed" as const, failed],
                ]}
                onSelect={(queue) =>
                  group.clientId && onSelectClientQueue(group.clientId, queue)
                }
                activeQueue={state.clientId === group.clientId ? state.queue : undefined}
                disabled={!group.clientId}
              />
            )
          })}
        </div>
      ) : null}

      <div className="flex flex-col gap-0.5">
        <RailHeading>Views</RailHeading>
        {SAVED_VIEWS.map((view) => (
          <RailRow
            key={view.slug}
            label={view.label}
            active={state.view === view.slug}
            onSelect={() => onSelectView(view.slug)}
          />
        ))}
      </div>
    </nav>
  )
}

function RailHeading({ children }: { children: React.ReactNode }) {
  // A span, not a heading: the page's h1 is "Reviews", and section headings in
  // a rail would sit above it in the outline.
  return (
    <span className="px-2 pb-1 text-caption font-medium tracking-wide text-ink-muted uppercase">
      {children}
    </span>
  )
}

function RailRow({
  label,
  count,
  countsPending,
  active,
  onSelect,
  indent,
  trailing,
  context,
}: {
  label: string
  count?: number
  countsPending?: boolean
  active?: boolean
  onSelect: () => void
  indent?: boolean
  trailing?: React.ReactNode
  /**
   * The client this row belongs to. Without it the agency-wide "Awaiting my
   * approval, 3 reviews" and a client's identical row announce the same, and
   * a screen-reader user has two buttons they cannot tell apart.
   */
  context?: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      // Spelled out rather than left to text concatenation: the label and the
      // count are adjacent elements with no whitespace between them, so the
      // row would otherwise announce as "Needs reply12".
      aria-label={[
        context,
        label,
        count === undefined || countsPending
          ? null
          : `${count} ${count === 1 ? "review" : "reviews"}`,
      ]
        .filter(Boolean)
        .join(", ")}
      className={cn(
        "flex items-center gap-2 rounded-(--np-radius-control) py-1.5 pr-2 text-left text-ui transition-colors duration-(--np-duration-fast)",
        indent ? "pl-7" : "pl-2",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        active
          ? "bg-accent-tint font-medium text-accent-ink"
          : "text-ink-muted hover:bg-[var(--np-hover-bg)] hover:text-ink"
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
      {count === undefined ? null : countsPending ? (
        // A skeleton, never a zero: showing "0" before the count arrives
        // tells the operator there is nothing to do when there may be plenty.
        <Skeleton className="h-3 w-5 rounded-(--np-radius-tag)" />
      ) : (
        <span className="text-caption tabular-nums">
          {count > 0 ? (
            count
          ) : (
            <>
              {/* The dash is a placeholder, not a word: without hiding it the
                  row announces as "Done–", which is neither a count nor a
                  name. */}
              <span aria-hidden>&ndash;</span>
              <span className="sr-only">none</span>
            </>
          )}
        </span>
      )}
    </button>
  )
}

function ClientGroup({
  name,
  health,
  rows,
  activeQueue,
  selected,
  disabled,
  onSelect,
}: {
  name: string
  health: ClientHealth | undefined
  rows: [ReviewQueue, number][]
  activeQueue: ReviewQueue | undefined
  selected: boolean
  disabled: boolean
  onSelect: (queue: ReviewQueue) => void
}) {
  const total = rows.reduce((sum, [, count]) => sum + count, 0)
  // Open when it is the client being viewed, or when it has work. A rail of
  // forty collapsed clients hides exactly the thing it exists to surface.
  const [open, setOpen] = React.useState(selected || total > 0)

  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        // The group's own toggle says what it does; its rows already carry the
        // client's name, so an unqualified name here would collide with them.
        aria-label={`${open ? "Collapse" : "Expand"} ${name}`}
        className="flex items-center gap-2 rounded-(--np-radius-control) px-2 py-1.5 text-left text-ui transition-colors duration-(--np-duration-fast) hover:bg-[var(--np-hover-bg)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {health ? <StatusPill tone={healthTone(health)} variant="dot" /> : null}
        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
        {health === "disconnected" || health === "not_connected" ? (
          <span
            className="flex text-danger-ink"
            title={`${name} is not syncing with Google`}
          >
            <TriangleAlert className="size-3.5" aria-hidden />
            <span className="sr-only">Not syncing with Google</span>
          </span>
        ) : null}
        <ChevronDown
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-ink-muted transition-transform duration-(--np-duration-fast)",
            open && "rotate-180"
          )}
        />
      </button>
      {open
        ? rows.map(([queue, count]) => (
            <RailRow
              key={queue}
              indent
              context={name}
              label={REVIEW_QUEUE_LABELS[queue]}
              count={count}
              active={selected && activeQueue === queue}
              onSelect={() => !disabled && onSelect(queue)}
            />
          ))
        : null}
    </div>
  )
}

export { InboxRail, QUEUE_ORDER }
