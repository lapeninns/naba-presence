"use client"

import { SendIcon } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useId, useMemo } from "react"

import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { ChipRow, FilterChip } from "@/components/ui/chip"
import { Empty } from "@/components/ui/empty"
import { ListRows } from "@/components/ui/list-row"
import { QueryStates, queryStatus } from "@/components/ui/query-states"
import { Skeleton } from "@/components/ui/skeleton"
import { TabCount, textTabItemClassName } from "@/components/ui/tabs"
import { ViewHeader } from "@/components/ui/view-header"
import { formatNumber } from "@/lib/format"
import {
  outboxViewFromSearch,
  type OutboxCounts,
  type OutboxItem,
  type OutboxKind,
} from "@/lib/outbox/contract"
import { flattenOutbox, useOutbox, useOutboxCounts } from "@/lib/outbox/queries"
import {
  OUTBOX_GROUPS,
  outboxGroupOf,
  type OutboxGroupKey,
} from "@/lib/outbox/vocabulary"
import { cn } from "@/lib/utils"

import { OutboxRow } from "./outbox-row"

const KIND_PLURAL: Record<OutboxKind, string> = {
  reply: "Replies",
  listing_change: "Listing changes",
  post: "Posts",
  bulk: "Bulk changes",
}

/** "Replies and posts", "Replies, posts and bulk changes". */
export function kindList(kinds: readonly OutboxKind[]): string {
  const words = kinds.map((kind, index) =>
    index === 0 ? KIND_PLURAL[kind] : KIND_PLURAL[kind].toLowerCase()
  )
  if (words.length <= 1) return words.join("")
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`
}

/**
 * The Outbox (DIRECTION §7.1): every write on its way to Google or back
 * from it, across replies, listing changes, posts and bulk changes, in four
 * groups: Waiting for a person, With Google, Failed, Confirmed today.
 *
 * It only reads. Each row opens the screen that can act on it, and a row's
 * state comes from the read model, which calls nothing "On Google" until
 * Google has confirmed it. The address holds the group and any narrowing
 * (`?group=`, `?clientId=`, `?locationId=`), so a link from elsewhere opens
 * the same list and Back returns to it.
 */
export function OutboxView() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const view = outboxViewFromSearch(searchParams)
  const scope = useMemo(
    () => ({ clientId: view.clientId, locationId: view.locationId }),
    [view.clientId, view.locationId]
  )
  const query = useOutbox(scope, view.group)
  const counts = useOutboxCounts(scope)
  const items = flattenOutbox(query.data)
  const first = query.data?.pages[0]
  const unavailable = first?.unavailable ?? []
  const paused = first?.paused ?? []
  const truncated = first?.truncated ?? false
  const incomplete =
    truncated || unavailable.length > 0 || counts.data?.partial === true
  const narrowed = Boolean(view.clientId || view.locationId)

  function navigate(change: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(change)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    const search = next.toString()
    router.replace(search ? `${pathname}?${search}` : pathname, {
      scroll: false,
    })
  }

  // Rows are already in group order from the server; the sections only
  // split them, so a page boundary never reorders anything.
  const sections = OUTBOX_GROUPS.filter(
    (group) => !view.group || group.key === view.group
  )
    .map((group) => ({
      ...group,
      items: items.filter((item) => outboxGroupOf(item.state) === group.key),
    }))
    .filter((section) => section.items.length > 0)

  const scopeName = narrowedName(items, view)

  return (
    <>
      <div className="flex flex-col gap-1">
        <ViewHeader title="Outbox" titleAs="h1" />
        <p className="max-w-prose text-body text-pretty text-ink-muted">
          Changes on their way to Google, and any that failed. Open one to act
          on it; nothing here is sent from this page.
        </p>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <GroupStrip
          current={view.group}
          counts={counts.data}
          countsPending={counts.isPending}
          countsPartial={incomplete}
          onChange={(group) => navigate({ group })}
        />
        {narrowed ? (
          <ChipRow aria-label="Filters">
            <FilterChip
              onRemove={() => navigate({ clientId: null, locationId: null })}
              removeLabel={`Remove filter: ${scopeName}. Show the whole Outbox`}
            >
              {scopeName}
            </FilterChip>
          </ChipRow>
        ) : null}
      </div>

      {paused.length ? (
        <Alert variant="warning">
          <AlertTitle>Sending to Google is paused</AlertTitle>
          <AlertDescription>
            {kindList(paused)} wait here while sending is paused. Nothing is
            lost, and nothing is sent until it resumes.
          </AlertDescription>
        </Alert>
      ) : null}

      {unavailable.length ? (
        <Alert variant="warning" live>
          <AlertTitle>This list is incomplete</AlertTitle>
          <AlertDescription>
            {kindList(unavailable)} could not be read, so they are missing here.
            That does not mean they reached Google.
          </AlertDescription>
          <AlertActions>
            <Button
              variant="secondary"
              pending={query.isRefetching}
              onClick={() => void query.refetch()}
            >
              Try again
            </Button>
          </AlertActions>
        </Alert>
      ) : null}

      {query.isError && query.data && !query.isFetchNextPageError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 text-body text-ink-secondary"
        >
          <p>
            The Outbox could not be refreshed. This list may be out of date.
          </p>
          <Button
            variant="secondary"
            pending={query.isFetching && !query.isFetchingNextPage}
            onClick={() => void query.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : null}

      {truncated ? (
        <p className="text-caption text-ink-muted">
          The list and counts include only the newest 200 items of each kind.
          Older items may be missing.
        </p>
      ) : null}

      <QueryStates
        status={queryStatus(
          { isPending: query.isPending, isError: query.isError && !query.data },
          { isEmpty: items.length === 0 && !query.hasNextPage }
        )}
        pendingLabel="Loading the Outbox"
        error={{ title: "The Outbox could not be loaded", cause: query.error }}
        onRetry={() => void query.refetch()}
        empty={
          view.group || narrowed ? (
            <Empty
              titleAs="h2"
              placement="page"
              title={
                incomplete
                  ? "No matches in the available results"
                  : view.group
                    ? `Nothing in ${groupTitle(view.group)}`
                    : "Nothing here for this filter"
              }
              description={
                incomplete
                  ? "Some items are missing from this list, so other items may still need attention."
                  : "Nothing else needs looking at here."
              }
              action={
                <Button
                  variant="secondary"
                  onClick={() =>
                    navigate({ group: null, clientId: null, locationId: null })
                  }
                >
                  Show the whole Outbox
                </Button>
              }
            />
          ) : (
            <Empty
              titleAs="h2"
              placement="page"
              icon={<SendIcon />}
              title={
                incomplete
                  ? "No matches in the available results"
                  : "Nothing on its way to Google"
              }
              description={
                incomplete
                  ? "Some items are missing from this list, so other items may still need attention."
                  : "Replies, listing changes, posts and bulk changes show here while they wait for a person or for Google, and when they fail. Changes confirmed on Google stay for a day."
              }
              action={
                <Link
                  href="/inbox"
                  className={buttonVariants({ variant: "secondary" })}
                >
                  Go to the Inbox
                </Link>
              }
            />
          )
        }
      >
        <div className="flex flex-col gap-6">
          {sections.map((section) => (
            <OutboxSection key={section.key} section={section} />
          ))}
        </div>
        {query.isFetchNextPageError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 text-body text-ink-secondary"
          >
            <p>More of the Outbox could not be loaded.</p>
            <Button
              variant="secondary"
              pending={query.isFetchingNextPage}
              pendingLabel="Loading…"
              onClick={() => void query.fetchNextPage()}
            >
              Try again
            </Button>
          </div>
        ) : query.hasNextPage ? (
          <Button
            variant="secondary"
            className="self-start"
            pending={query.isFetchingNextPage}
            pendingLabel="Loading…"
            onClick={() => void query.fetchNextPage()}
          >
            Load more
          </Button>
        ) : null}
      </QueryStates>
    </>
  )
}

function groupTitle(key: OutboxGroupKey): string {
  return OUTBOX_GROUPS.find((group) => group.key === key)?.title ?? ""
}

/**
 * The narrowing's words. The rows carry the names; with no rows to read
 * them from, it says what kind of filter is on.
 */
function narrowedName(
  items: readonly OutboxItem[],
  view: { clientId?: string; locationId?: string }
): string {
  if (view.locationId) {
    const row = items.find((item) => item.locationId === view.locationId)
    return row ? `Only ${row.locationName}` : "One listing"
  }
  const row = items.find((item) => item.clientId === view.clientId)
  return row?.clientName ? `Only ${row.clientName}` : "One client"
}

function OutboxSection({
  section,
}: {
  section: {
    key: OutboxGroupKey
    title: string
    note: string
    items: OutboxItem[]
  }
}) {
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      data-group={section.key}
      className="flex flex-col gap-2"
    >
      <div className="flex flex-col gap-0.5">
        <h2 id={headingId} className="text-section font-semibold text-ink">
          {section.title}{" "}
          <span className="font-normal text-ink-muted tabular-nums">
            {formatNumber(section.items.length)}
          </span>
        </h2>
        <p className="text-caption text-ink-muted">{section.note}</p>
      </div>
      <ListRows
        bleed
        data-density="compact"
        aria-labelledby={headingId}
        className="md:overflow-hidden md:rounded-(--np-radius-card) md:border md:border-line md:bg-surface"
      >
        {section.items.map((item) => (
          <OutboxRow key={item.id} item={item} />
        ))}
      </ListRows>
    </section>
  )
}

/**
 * All plus the four groups, as text tabs. A non-zero Failed count is drawn
 * in the danger ink with its own word, because that number is the
 * exception; the others are plain figures, and a zero draws none.
 */
function GroupStrip({
  current,
  counts,
  countsPending,
  countsPartial,
  onChange,
}: {
  current: OutboxGroupKey | undefined
  counts: OutboxCounts | undefined
  countsPending: boolean
  countsPartial: boolean
  onChange: (group: OutboxGroupKey | null) => void
}) {
  const tabs: { key: OutboxGroupKey | null; title: string }[] = [
    { key: null, title: "All" },
    ...OUTBOX_GROUPS.map((group) => ({ key: group.key, title: group.title })),
  ]
  return (
    <nav aria-label="Outbox groups" className="flex max-w-full min-w-0">
      <ChipRow className="gap-0.5">
        {tabs.map((tab) => {
          const active = (current ?? null) === tab.key
          const count = tab.key && counts ? counts[tab.key] : 0
          const alert = tab.key === "failed" && count > 0
          const figure = tab.key !== null
          return (
            <button
              key={tab.key ?? "all"}
              type="button"
              data-slot="outbox-group-tab"
              data-group={tab.key ?? "all"}
              aria-current={active ? "true" : undefined}
              onClick={() => onChange(tab.key)}
              aria-label={[
                tab.title,
                figure && !countsPending && (count > 0 || countsPartial)
                  ? `${count} ${count === 1 ? "item" : "items"}${countsPartial ? " shown in the available results" : ""}`
                  : null,
              ]
                .filter(Boolean)
                .join(", ")}
              className={textTabItemClassName}
            >
              <span>{tab.title}</span>
              {!figure ? null : countsPending ? (
                <Skeleton className="h-3 w-4" />
              ) : (
                <TabCount
                  aria-hidden
                  className={cn(alert && "font-semibold text-danger-ink")}
                >
                  {formatNumber(count)}
                  {countsPartial ? " shown" : null}
                </TabCount>
              )}
            </button>
          )
        })}
      </ChipRow>
    </nav>
  )
}
