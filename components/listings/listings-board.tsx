"use client"

import {
  ChevronDownIcon,
  CircleAlertIcon,
  RefreshCwIcon,
  StoreIcon,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import * as React from "react"

import { ShellLink } from "@/components/app-shell/shell-link"
import { ClientAvatar } from "@/components/clients/client-avatar"
import { AddListingsLink } from "@/components/listings/add-listings-link"
import { FileUnderClient } from "@/components/listings/file-under-client"
import { ActionBar, ActionBarMuted } from "@/components/ui/action-bar"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  FilterChip,
  FilterChipStrip,
  filterChipClassName,
} from "@/components/ui/chip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyIllustration } from "@/components/ui/empty"
import {
  QuickLookFact,
  QuickLookFacts,
  QuickLookPanel,
  QuickLookSection,
  useQuickLook,
} from "@/components/ui/quick-look-panel"
import { RelativeTime } from "@/components/ui/relative-time"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSelectAllLabel,
} from "@/components/ui/table"
import { Toolbar } from "@/components/ui/toolbar"
import type { ListingSummary } from "@/lib/contracts/location-summary"
import { formatNumber } from "@/lib/format"
import { areaState } from "@/lib/listings/area-state"
import {
  googleChangedCount,
  listingAttentionReason,
  listingHealth,
  listingHealthDescription,
  listingHealthLabel,
  listingHealthTone,
  summariseListingHealth,
  unpublishedCount,
  type ListingHealth,
} from "@/lib/listings/health"
import { BULK_MAX_TARGETS } from "@/lib/domain/bulk-merge"
import {
  compareMostToFix,
  completenessLabel,
  completenessTone,
  failingChecks,
  type ListingCompleteness,
} from "@/lib/listings/completeness"
import { useBoardCompleteness } from "@/lib/queries/use-listing-completeness"
import { visibleFix } from "@/lib/listings/completeness-view"
import { listingHref } from "@/lib/listings/areas"
import { formatAddressLine } from "@/lib/locations/address"
import { useClients } from "@/lib/queries/use-clients"
import { useWorkspaceMode } from "@/lib/workspace/mode"
import { useListingSummaries } from "@/lib/queries/use-listing-summary"
import {
  useLocationDirectory,
  type DirectoryEntry,
} from "@/lib/queries/use-locations"
import { cn } from "@/lib/utils"
import { useNow } from "@/lib/time/server-now"
import { replaceUrl } from "@/lib/navigation/shallow-url"

const HEALTH_FILTERS = [
  { value: "all", label: "All" },
  { value: "attention", label: "Needs attention" },
  { value: "unpublished", label: "To publish" },
  { value: "not_linked", label: "Not linked" },
  { value: "healthy", label: "In sync" },
] as const
type HealthFilter = (typeof HEALTH_FILTERS)[number]["value"]

function isHealthFilter(value: string | null): value is HealthFilter {
  return HEALTH_FILTERS.some((filter) => filter.value === value)
}

/**
 * Worst health first across every client, grouped under each client, or
 * the most incomplete listing first (the heaviest failing completeness
 * checks, then the lowest score).
 */
type BoardOrder = "health" | "client" | "fix"

const BOARD_ORDERS: readonly { value: BoardOrder; label: string }[] = [
  { value: "health", label: "Worst first" },
  { value: "client", label: "By client" },
  { value: "fix", label: "Most to fix" },
]

function parseOrder(value: string | null): BoardOrder {
  return value === "fix" || value === "client" ? value : "health"
}

/**
 * The order, folded into the health strip as one chip ("Worst first ⌄"):
 * a menu of the orders (a sheet on a phone) rather than a row of its
 * own. Styled as a filter chip, but not pressed: it names the current
 * choice instead of switching a filter on.
 */
function OrderChip({
  value,
  onChange,
  business,
  className,
}: {
  value: BoardOrder
  onChange: (next: BoardOrder) => void
  /** A business has no clients, so no "By client". */
  business: boolean
  className?: string
}) {
  const orders = BOARD_ORDERS.filter(
    (order) => !business || order.value !== "client"
  )
  const current = orders.find((order) => order.value === value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-slot="order-chip"
        // The name contains the visible words (WCAG 2.5.3).
        aria-label={`Order listings: ${current?.label}`}
        className={filterChipClassName({
          className: cn("data-popup-open:bg-fill", className),
        })}
      >
        {current?.label}
        <ChevronDownIcon aria-hidden strokeWidth={1.75} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" title="Order listings">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next: string) => onChange(next as BoardOrder)}
        >
          {orders.map((order) => (
            <DropdownMenuRadioItem
              key={order.value}
              value={order.value}
              closeOnClick
              indicatorPosition="end"
            >
              {order.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const UNFILED = "__unfiled__"
/** As the inbox's search (review-filters.tsx): the URL follows a pause. */
const SEARCH_URL_DELAY_MS = 300

type BoardRow = {
  entry: DirectoryEntry
  summary: ListingSummary | undefined
  /** Undefined while loading, or when it couldn't be read. */
  completeness: ListingCompleteness | undefined
  health: ListingHealth
  verified: boolean | undefined
  clientId: string
  clientName: string
}

function matchesHealth(health: ListingHealth, filter: HealthFilter): boolean {
  switch (filter) {
    case "all":
      return true
    case "attention":
      return (
        health === "attention" ||
        health === "disconnected" ||
        health === "access_lost"
      )
    case "unpublished":
      return health === "unpublished"
    case "not_linked":
      return health === "not_linked" || health === "pending_verification"
    case "healthy":
      return health === "healthy"
  }
}

/** Worst first, then by name, so the top of the board is the to-do list. */
const HEALTH_ORDER: Record<ListingHealth, number> = {
  disconnected: 0,
  access_lost: 0,
  attention: 1,
  unpublished: 2,
  pending_verification: 3,
  not_linked: 4,
  unchecked: 4,
  partially_checked: 4,
  healthy: 5,
}

/**
 * When this listing's reviews were last successfully checked with Google,
 * named as reviews: it says nothing about the profile, hours or menu.
 * and whether that is late. Only successful checks count, so a sync that
 * keeps failing shows its age here instead of looking fresh.
 */
function FreshnessLine({ summary }: { summary: ListingSummary | undefined }) {
  const freshness = summary?.freshness
  if (!freshness) return null
  const checked = freshness.lastCheckedAt ? (
    <RelativeTime iso={freshness.lastCheckedAt} prefix="Reviews checked " />
  ) : (
    "Reviews not checked yet"
  )
  return (
    <span
      className={cn(
        "text-caption",
        freshness.state === "data_delayed"
          ? "text-warning-ink"
          : "text-ink-muted"
      )}
    >
      {checked}
      {freshness.state === "data_delayed" ? " · delayed, retrying" : null}
    </span>
  )
}

/**
 * How many things wait on a listing, as one figure: the phone row's compact
 * stand-in for the Waiting column's pills.
 */
function waitingCount(summary: ListingSummary): number {
  return (
    unpublishedCount(summary) +
    googleChangedCount(summary) +
    summary.posts.awaitingApproval
  )
}

/** No summary, or nothing waiting and no failed publish. */
function quietRow(summary: ListingSummary | undefined) {
  if (!summary) return true
  const failed =
    summary.lastPublish?.status === "failed" || summary.posts.failed > 0
  return !failed && waitingCount(summary) === 0
}

/** The phone row's one-line Waiting figure (the pills show from 48rem). */
function WaitingFigure({ summary }: { summary: ListingSummary | undefined }) {
  if (!summary) return <span className="text-ink-muted">—</span>
  const failed =
    summary.lastPublish?.status === "failed" || summary.posts.failed > 0
  const count = waitingCount(summary)
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-secondary">
      {count > 0 ? (
        <span className="tabular-nums">{formatNumber(count)} waiting</span>
      ) : failed ? null : (
        <span className="text-ink-muted">Nothing waiting</span>
      )}
      {failed ? <StatusPill tone="at-risk">Failed publish</StatusPill> : null}
    </span>
  )
}

function PendingChips({ summary }: { summary: ListingSummary | undefined }) {
  if (!summary) return <span className="text-ink-muted">—</span>
  const parts: {
    key: string
    label: string
    tone: "pending" | "attention" | "at-risk"
  }[] = []
  const unpublished = unpublishedCount(summary)
  if (unpublished > 0)
    parts.push({
      key: "unpublished",
      label:
        unpublished === 1
          ? "1 change to publish"
          : `${formatNumber(unpublished)} changes to publish`,
      tone: "pending",
    })
  const changed = googleChangedCount(summary)
  if (changed > 0)
    parts.push({
      key: "google",
      label:
        changed === 1
          ? "1 Google change"
          : `${formatNumber(changed)} Google changes`,
      tone: "attention",
    })
  if (summary.posts.awaitingApproval > 0)
    parts.push({
      key: "posts",
      label:
        summary.posts.awaitingApproval === 1
          ? "1 post awaiting approval"
          : `${formatNumber(summary.posts.awaitingApproval)} posts awaiting approval`,
      tone: "pending",
    })
  if (summary.lastPublish?.status === "failed" || summary.posts.failed > 0)
    parts.push({ key: "failed", label: "Failed publish", tone: "at-risk" })
  if (parts.length === 0)
    return <span className="text-ink-muted">Nothing waiting</span>
  return (
    <span className="flex flex-wrap gap-1.5">
      {parts.map((part) => (
        <StatusPill key={part.key} tone={part.tone}>
          {part.label}
        </StatusPill>
      ))}
    </span>
  )
}

/** The areas a quick look reports: the ones compared with Google. */
const QUICK_LOOK_AREAS = [
  { key: "profile", label: "Business profile" },
  { key: "hours", label: "Opening hours" },
  { key: "menu", label: "Food menu" },
] as const

/**
 * The desk quick look for one listing (DSK-23): its health in words, the
 * state of each area compared with Google, what is waiting and when it was
 * last checked and published, with "Open listing" for the workspace. Each
 * area links straight to its tab, and says where it stands in the
 * overview's own words (`areaState`), so the panel never shows "In sync"
 * beside a listing that needs attention or Google out of reach.
 */
function ListingQuickLook({
  row,
  business,
  canManage,
  now,
  summaryPending,
  summaryFailed,
  ...panel
}: {
  row: BoardRow
  business: boolean
  /** Owner or admin: owner-only areas are a fix they can follow. */
  canManage: boolean
  /** The board's `useNow()`, so an overdue check reads the same everywhere. */
  now: number
  summaryPending: boolean
  /** The summaries could not be read at all (no earlier data to show). */
  summaryFailed: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  returnFocus?: React.RefObject<HTMLElement | null>
}) {
  const { entry, summary } = row
  const address = formatAddressLine(entry.address)
  const client = business || row.clientId === UNFILED ? null : row.clientName
  // Without the summaries, "Not checked" would be a guess: the board's own
  // read is what is missing, not a check of the listing.
  const known = !(
    (summaryPending || summaryFailed) &&
    row.health === "unchecked"
  )
  // The one cause, when there is only one (no hours on Google); otherwise
  // the general sentence.
  const reason =
    row.health === "attention"
      ? (listingAttentionReason(summary, now) ??
        listingHealthDescription(row.health))
      : listingHealthDescription(row.health)
  const areas = QUICK_LOOK_AREAS.filter(
    (area) => area.key !== "menu" || summary?.menu.eligible !== false
  )
  return (
    <QuickLookPanel
      {...panel}
      title={entry.name}
      description={
        client || address
          ? [client, address].filter(Boolean).join(" · ")
          : undefined
      }
      status={
        known ? (
          <>
            <StatusPill tone={listingHealthTone(row.health)}>
              {listingHealthLabel(row.health)}
            </StatusPill>
            <span className="text-caption text-ink-muted">{reason}</span>
          </>
        ) : (
          <span className="text-caption text-ink-muted">
            {summaryFailed
              ? "We couldn’t check this listing just now. Open it to see each area."
              : "Checking this listing…"}
          </span>
        )
      }
      openHref={listingHref(entry.id)}
      openLabel="Open listing"
    >
      {entry.linked && summary ? (
        <QuickLookSection title="Areas">
          <QuickLookFacts>
            {areas.map((area) => {
              const state = areaState(area.key, summary, now)
              return (
                <QuickLookFact
                  key={area.key}
                  label={
                    <Link
                      href={listingHref(entry.id, area.key)}
                      className="rounded-(--np-radius-tag) underline-offset-4 focus-halo hover:underline"
                    >
                      {area.label}
                    </Link>
                  }
                >
                  <StatusPill tone={state.tone}>{state.label}</StatusPill>
                </QuickLookFact>
              )
            })}
          </QuickLookFacts>
        </QuickLookSection>
      ) : null}
      {entry.linked && row.completeness ? (
        <QuickLookSection title="Completeness">
          <CompletenessFacts
            completeness={row.completeness}
            canManage={canManage}
          />
        </QuickLookSection>
      ) : null}
      {summary ? (
        <QuickLookSection title="Waiting">
          <PendingChips summary={summary} />
        </QuickLookSection>
      ) : null}
      <QuickLookSection title="Google">
        <QuickLookFacts>
          <QuickLookFact label="Verification">
            <VerificationCell row={row} />
          </QuickLookFact>
          {summary?.freshness ? (
            <QuickLookFact label="Last check">
              <FreshnessLine summary={summary} />
            </QuickLookFact>
          ) : null}
          <QuickLookFact label="Last published">
            <span className="text-ink-muted tabular-nums">
              {!summary ? (
                "—"
              ) : summary.lastPublish ? (
                <RelativeTime iso={summary.lastPublish.at} />
              ) : (
                "Never"
              )}
            </span>
            {/* The listing page's words for a publish that did not land. */}
            {summary?.lastPublish?.status === "failed" ? (
              <StatusPill tone="at-risk">Failed</StatusPill>
            ) : summary?.lastPublish?.status === "ambiguous" ? (
              <StatusPill tone="attention">Outcome unclear</StatusPill>
            ) : summary?.lastPublish?.status === "in_progress" ? (
              <StatusPill tone="pending">In progress</StatusPill>
            ) : null}
          </QuickLookFact>
        </QuickLookFacts>
      </QuickLookSection>
    </QuickLookPanel>
  )
}

/** Sorts after any listing whose completeness is known. */
const UNSCORED = { fixPoints: 0, score: null }

/**
 * The completeness score, with the most important thing to fix under it on
 * a desk. On a phone it joins the row's caption line ("Completeness 82%").
 */
function CompletenessCell({
  completeness,
  linked,
  pending,
}: {
  completeness: ListingCompleteness | undefined
  linked: boolean
  pending: boolean
}) {
  if (!linked)
    return (
      <span className="text-ink-muted">
        <span aria-hidden>—</span>
        <span className="sr-only">Not linked</span>
      </span>
    )
  if (!completeness)
    return pending ? (
      <Skeleton className="h-3.5 w-12 @3xl/table:h-5.5 @3xl/table:w-16" />
    ) : (
      <span className="text-ink-muted">
        <span aria-hidden>—</span>
        <span className="sr-only">Couldn’t check</span>
      </span>
    )
  const first = failingChecks(completeness)[0]
  const label = completenessLabel(completeness.score)
  return (
    <>
      {/* Mid-line on the phone's caption, so lower case there. */}
      <span className={PHONE.onlyInline}>
        {completeness.score === null ? "no score yet" : label}
      </span>
      <span className={cn("flex flex-col items-start gap-1", PHONE.wide)}>
        <StatusPill tone={completenessTone(completeness.score)}>
          {label}
        </StatusPill>
        {first ? (
          <span className="text-caption text-ink-muted">
            {completeness.counts.fail > 1
              ? `${first.title} +${formatNumber(completeness.counts.fail - 1)}`
              : first.title}
          </span>
        ) : null}
      </span>
    </>
  )
}

/** The quick look's top three things to fix, each linked to its area. */
function CompletenessFacts({
  completeness,
  canManage,
}: {
  completeness: ListingCompleteness
  canManage: boolean
}) {
  const failing = failingChecks(completeness)
  return (
    <QuickLookFacts>
      <QuickLookFact label="Score">
        <StatusPill tone={completenessTone(completeness.score)}>
          {completenessLabel(completeness.score)}
        </StatusPill>
      </QuickLookFact>
      {failing.length === 0 ? (
        <QuickLookFact label="To fix">
          <span className="text-ink-muted">Nothing</span>
        </QuickLookFact>
      ) : (
        failing.slice(0, 3).map((check) => {
          const fix = visibleFix(check, canManage)
          return (
            <QuickLookFact
              key={check.id}
              label={
                fix ? (
                  <Link
                    href={fix.href}
                    className="rounded-(--np-radius-tag) underline-offset-4 focus-halo hover:underline"
                  >
                    {check.title}
                  </Link>
                ) : (
                  check.title
                )
              }
            >
              <span className="text-ink-muted">{check.detail}</span>
            </QuickLookFact>
          )
        })
      )}
    </QuickLookFacts>
  )
}

function VerificationCell({ row }: { row: BoardRow }) {
  if (!row.entry.linked || row.verified === undefined)
    return <span className="text-ink-muted">—</span>
  return row.verified ? (
    <StatusPill tone="healthy">Verified</StatusPill>
  ) : (
    <StatusPill tone="attention">Not verified</StatusPill>
  )
}

const COLUMNS = [
  "Listing",
  "Client",
  "Health",
  "Completeness",
  "Waiting",
  "Verification",
  "Last published",
] as const

/** A business has no client layer, so its board has no Client column. */
function columnsFor(business: boolean) {
  return business ? COLUMNS.filter((column) => column !== "Client") : COLUMNS
}

/*
 * The phone row (the table's container under 48rem) is a record card laid
 * out by the Table's own cell priorities, the anatomy of a list row:
 *
 *   [select] Listing name ........................ ›
 *            Client · address           [health pill]
 *            n waiting
 *            Client: File under…   (unfiled rows only)
 *
 * The verification and last-published columns step aside (desk-only; they
 * are one tap away on the listing). These classes only show or hide content
 * INSIDE a cell, so none of them has to fight the table's own rules.
 */
const PHONE = {
  /** Shown only on the phone row. */
  only: "hidden @max-3xl/table:inline-flex",
  /** Inline text shown only on the phone row. */
  onlyInline: "hidden @max-3xl/table:inline",
  /** Shown only from 48rem. */
  wide: "@max-3xl/table:hidden",
} as const

/** The table's frame, shared by the loaded board and its skeleton. */
function BoardTable({
  children,
  busy = false,
  selectable = false,
  selectAll,
}: {
  children: React.ReactNode
  busy?: boolean
  /** Owners and admins select listings for a bulk change. */
  selectable?: boolean
  /**
   * The select-all checkbox and its TableSelectAllLabel, for the header's
   * selection column. As record cards (a phone) the header row hides but a
   * cell holding a checkbox survives as a bar above the cards, so one
   * control serves every width.
   */
  selectAll?: React.ReactNode
}) {
  const business = useWorkspaceMode() === "business"
  return (
    <Table surface responsive aria-busy={busy || undefined}>
      <caption className="sr-only">
        Listings, with their Google health and what is waiting on each
      </caption>
      <TableHeader>
        <TableRow>
          {selectable ? (
            <TableHead className="w-10">
              {selectAll ?? <span className="sr-only">Select</span>}
            </TableHead>
          ) : null}
          {columnsFor(business).map((column) => (
            <TableHead key={column}>{column}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
  )
}

function BoardSkeleton({ canManage = false }: { canManage?: boolean }) {
  const business = useWorkspaceMode() === "business"
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      {/* The toolbar's shape: the search pill on its own row, then the
          chip strip (and, agency only, the order chip at its end). */}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-(--np-touch) w-full rounded-(--np-radius-pill) desk:h-(--np-control-h)" />
        <div className="flex gap-1.5 overflow-hidden">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton
              key={index}
              className="h-(--np-chip-h) w-24 shrink-0 rounded-(--np-radius-pill)"
            />
          ))}
          <Skeleton className="h-(--np-chip-h) w-28 shrink-0 rounded-(--np-radius-pill)" />
        </div>
      </div>
      <BoardTable busy>
        {[0, 1, 2, 3, 4].map((index) => (
          <TableRow key={index} aria-hidden>
            <TableCell priority="primary">
              <span className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-40 max-w-full" />
                <Skeleton className="h-3 w-56 max-w-full" />
              </span>
            </TableCell>
            {business ? null : (
              <TableCell priority="desk-only">
                <Skeleton className="h-3.5 w-28" />
              </TableCell>
            )}
            <TableCell priority="trailing" className="@max-3xl/table:self-end">
              <Skeleton className="h-5.5 w-24" />
            </TableCell>
            <TableCell priority="meta">
              <Skeleton className="h-3.5 w-12 @3xl/table:h-5.5 @3xl/table:w-16" />
            </TableCell>
            <TableCell priority="meta">
              <Skeleton className="h-3.5 w-24 @3xl/table:h-5.5 @3xl/table:w-32" />
            </TableCell>
            <TableCell priority="desk-only">
              <Skeleton className="h-5.5 w-20" />
            </TableCell>
            <TableCell priority="desk-only">
              <Skeleton className="h-3.5 w-20" />
            </TableCell>
          </TableRow>
        ))}
      </BoardTable>
      {canManage ? (
        <div>
          <AddListingsLink />
        </div>
      ) : null}
    </div>
  )
}

/**
 * Every listing the session can see, health first.
 *
 * By default the board is one list, worst health first across every client,
 * so the top of it is the to-do list. "By client" groups it instead: unfiled
 * listings lead, under their own group row, because that is where a newly
 * linked listing lands and the one thing it needs is a client. The search,
 * health, client and order choices live in the URL (`q`, `health`,
 * `clientId`, `order`), so a filtered board can be shared or reloaded. The
 * Waiting column reads the DB-only summary, so the board answers "what is
 * waiting on which listing" without a single Google call. Below 48rem of
 * width each row becomes a compact record (name; client · address with the
 * health pill; one waiting figure; chevron) that is one tap target, and the
 * filters are pressed buttons (client chips, health chips), so moving
 * through them by keyboard never re-filters the board. The order is one
 * chip at the end of the health strip that opens a menu of the two orders,
 * and "Add listings from Google" closes the list (it is not a header row
 * above the first listing).
 */
function ListingsBoard({
  role,
  bulkEnabled = false,
}: {
  role: string | null
  /** The organisation's `bulk_actions` feature; off hides bulk selection. */
  bulkEnabled?: boolean
}) {
  const now = useNow()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const canManage = role === "owner" || role === "admin"
  const canSelect = canManage && bulkEnabled
  // Explicit listing ids for a bulk change. Filters only change what is shown;
  // the bulk preview freezes exactly these ids.
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(
    () => new Set()
  )
  const selectAllReasonId = React.useId()
  const selectionStatusId = React.useId()
  // Where focus goes when "Clear selection" takes its own bar away.
  const selectAllRef = React.useRef<HTMLSpanElement>(null)
  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      if (on && next.size < BULK_MAX_TARGETS) next.add(id)
      if (!on) next.delete(id)
      return next
    })
  const directory = useLocationDirectory(role)
  const clients = useClients()
  const summaries = useListingSummaries()
  const completeness = useBoardCompleteness()
  // From `lg` a row click answers "what is waiting here?" in a side panel;
  // Enter and a modifier click on the row's link still open the listing
  // (DSK-23).
  const quick = useQuickLook<BoardRow>()
  // A business has no client layer: no Client column, chips, grouping or
  // filter, whatever a stale address says.
  const business = useWorkspaceMode() === "business"

  // Local state answers each keystroke at once; the URL follows it (replace,
  // not push, so Back leaves the board rather than undoing filters). The URL
  // is rewritten through the history API, so no change here asks the server
  // for anything, and a search waits for a pause in the typing.
  const [search, setSearchState] = React.useState(
    () => searchParams.get("q") ?? ""
  )
  const [health, setHealthState] = React.useState<HealthFilter>(() => {
    const value = searchParams.get("health")
    return isHealthFilter(value) ? value : "all"
  })
  const [clientFilterState, setClientState] = React.useState<string | null>(
    () => searchParams.get("clientId")
  )
  const clientFilter = business ? null : clientFilterState
  // The top-bar client switcher changes `?clientId=` from outside the board,
  // so the chips follow the address whenever it moves on its own. Adjusted
  // during render, not in an effect, so no frame shows the old client.
  const urlClient = searchParams.get("clientId")
  const [seenUrlClient, setSeenUrlClient] = React.useState(urlClient)
  if (urlClient !== seenUrlClient) {
    setSeenUrlClient(urlClient)
    setClientState(urlClient)
  }
  const [orderState, setOrderState] = React.useState<BoardOrder>(() =>
    parseOrder(searchParams.get("order"))
  )
  const order: BoardOrder =
    business && orderState === "client" ? "health" : orderState

  const pendingSearch = React.useRef<{ q: string; timer: number } | null>(null)
  React.useEffect(
    () => () => window.clearTimeout(pendingSearch.current?.timer),
    []
  )
  const writeUrl = (change: {
    q?: string
    health?: HealthFilter
    clientId?: string | null
    order?: BoardOrder
  }) => {
    // A search still waiting out its pause goes with this write, so neither
    // undoes the other.
    const pending = pendingSearch.current
    if (pending) {
      window.clearTimeout(pending.timer)
      pendingSearch.current = null
    }
    const next =
      pending && change.q === undefined ? { ...change, q: pending.q } : change
    // The address as it is now, not as this render saw it: the top-bar
    // switcher can move `?clientId=` while a search waits.
    const params = new URLSearchParams(window.location.search)
    const set = (
      key: string,
      value: string | null | undefined,
      empty: string
    ) => {
      if (value === undefined) return
      if (value === null || value === empty) params.delete(key)
      else params.set(key, value)
    }
    set("q", next.q?.trim() === "" ? "" : next.q, "")
    set("health", next.health, "all")
    set("clientId", next.clientId, "")
    set("order", next.order, "health")
    const query = params.toString()
    replaceUrl(query ? `${pathname}?${query}` : pathname)
  }
  const setSearch = (value: string) => {
    setSearchState(value)
    window.clearTimeout(pendingSearch.current?.timer)
    pendingSearch.current = {
      q: value,
      timer: window.setTimeout(() => {
        pendingSearch.current = null
        writeUrl({ q: value })
      }, SEARCH_URL_DELAY_MS),
    }
  }
  const setHealth = (value: HealthFilter) => {
    setHealthState(value)
    writeUrl({ health: value })
  }
  const setClientFilter = (value: string | null) => {
    setClientState(value)
    writeUrl({ clientId: value })
  }
  const setOrder = (value: BoardOrder) => {
    setOrderState(value)
    writeUrl({ order: value })
  }

  // "Check again" after the summaries failed: once it lands, its line and
  // button go, so focus that was on the button returns to the page.
  const summaryRetry = React.useRef(false)
  React.useEffect(() => {
    if (!summaryRetry.current || summaries.isError) return
    summaryRetry.current = false
    if (document.activeElement === document.body)
      document.getElementById("main")?.focus()
  }, [summaries.isError])

  // A board narrowed to one client sends "Add listings" straight to that
  // client's setup. Only a client the session can see, so a stale address
  // falls back to the chooser rather than a missing page.
  const addClientId =
    !business &&
    clientFilter &&
    clientFilter !== UNFILED &&
    clients.data?.items.some((client) => client.id === clientFilter)
      ? clientFilter
      : undefined

  if (directory.isPending) return <BoardSkeleton canManage={canManage} />
  // A failed background refetch keeps the board it already has.
  if (directory.isError && !directory.data) {
    return (
      <div className="flex flex-col gap-4">
        <Empty
          framed
          variant="error"
          titleAs="h2"
          // It replaces the board, so it is announced; the retry sits
          // outside the alert, which reads what happened, not the button.
          role="alert"
          title="We couldn’t load your listings"
          description="We didn’t get an answer just now, so nothing is shown rather than part of the list. Nothing was changed."
          actions={
            <Button
              variant="secondary"
              pending={directory.isFetching}
              pendingLabel="Trying again…"
              onClick={() => void directory.refetch()}
            >
              <RefreshCwIcon aria-hidden />
              Try again
            </Button>
          }
        />
        {/* Setup does not depend on the directory, so owners and admins
            can still add listings while it is down. */}
        {canManage ? (
          <div>
            <AddListingsLink clientId={addClientId} />
          </div>
        ) : null}
      </div>
    )
  }

  const summaryById = new Map(
    (summaries.data ?? []).map((summary) => [summary.locationId, summary])
  )
  const completenessById = new Map(
    (completeness.data ?? []).map((entry) => [entry.locationId, entry])
  )
  const rows: BoardRow[] = (directory.data ?? []).map((entry) => {
    const summary = summaryById.get(entry.id)
    return {
      entry,
      summary,
      completeness: completenessById.get(entry.id),
      // Either source saying "not verified" wins, as it does for health.
      verified:
        entry.verified === false || summary?.verified === false
          ? false
          : (entry.verified ?? summary?.verified),
      health: listingHealth({
        linked: entry.linked,
        verified: entry.verified ?? summary?.verified,
        summary,
        now,
      }),
      clientId: entry.clientId ?? UNFILED,
      clientName: entry.clientName ?? "Not filed under a client",
    }
  })

  if (rows.length === 0) {
    return (
      <Empty
        framed
        icon={<StoreIcon />}
        titleAs="h2"
        title="No listings yet"
        description={
          canManage
            ? business
              ? "Connect your Google login and link your locations, and they appear here with their health."
              : "Connect a client’s Google login and link its locations, and they appear here with their health."
            : "Nothing is linked to Google yet. An owner or admin can add the first listing."
        }
        action={
          canManage ? <AddListingsLink clientId={addClientId} /> : undefined
        }
      />
    )
  }

  const needle = search.trim().toLowerCase()
  const matchesSearch = (row: BoardRow) =>
    needle
      ? row.entry.name.toLowerCase().includes(needle) ||
        (!business && row.clientName.toLowerCase().includes(needle))
      : true
  const inScope = rows
    .filter((row) => (clientFilter ? row.clientId === clientFilter : true))
    .filter(matchesSearch)
  const visible = inScope
    .filter((row) => matchesHealth(row.health, health))
    .sort((a, b) => {
      const worst = HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health]
      if (order === "fix") {
        // Most to fix first; a listing whose completeness isn't known goes
        // last, then the usual worst-first order breaks ties.
        const fix = compareMostToFix(
          a.completeness ?? UNSCORED,
          b.completeness ?? UNSCORED
        )
        if (fix !== 0) return fix
        return worst !== 0 ? worst : a.entry.name.localeCompare(b.entry.name)
      }
      if (order === "health")
        // Worst health first across every client, then by name.
        return worst !== 0 ? worst : a.entry.name.localeCompare(b.entry.name)
      // Unfiled first, then by client, then worst health, then name.
      if ((a.clientId === UNFILED) !== (b.clientId === UNFILED))
        return a.clientId === UNFILED ? -1 : 1
      if (a.clientId !== b.clientId)
        return a.clientName.localeCompare(b.clientName)
      return worst !== 0 ? worst : a.entry.name.localeCompare(b.entry.name)
    })

  const clientChips = business
    ? []
    : [
        ...(rows.some((row) => row.clientId === UNFILED)
          ? [
              {
                id: UNFILED,
                name: "Unfiled",
                count: rows.filter((row) => row.clientId === UNFILED).length,
              },
            ]
          : []),
        ...(clients.data?.items ?? []).map((client) => ({
          id: client.id,
          name: client.name,
          count: rows.filter((row) => row.clientId === client.id).length,
        })),
      ].filter((chip) => chip.count > 0)

  const grouped = !business && order === "client"
  const unfiled = grouped
    ? visible.filter((row) => row.clientId === UNFILED)
    : []
  const filed = grouped
    ? visible.filter((row) => row.clientId !== UNFILED)
    : visible

  // The empty state that held the button goes; focus moves to the search,
  // where the board's narrowing starts, rather than falling to the page.
  const focusSearch = () =>
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLInputElement>('input[aria-label="Search listings"]')
        ?.focus()
    )
  const clearFilters = () => {
    setSearchState("")
    setHealthState("all")
    setClientState(null)
    writeUrl({ q: "", health: "all", clientId: null })
    focusSearch()
  }
  // With nothing shown, say what is narrowing the board, and when the search
  // does match listings under another health or client, offer those without
  // dropping what was typed.
  const searchMatches = needle ? rows.filter(matchesSearch).length : 0
  const narrowed = health !== "all" || clientFilter !== null
  const healthLabel =
    HEALTH_FILTERS.find((filter) => filter.value === health)?.label ?? ""
  // A client with no listings left has no chip to show it is chosen, so its
  // name is said here.
  const clientName =
    clientFilter === UNFILED
      ? "Unfiled"
      : clients.data?.items.find((client) => client.id === clientFilter)?.name
  const clientLabel = clientName ? `“${clientName}”` : "this client"
  const scope = [
    health !== "all" ? `“${healthLabel}”` : null,
    clientFilter ? clientLabel : null,
  ]
    .filter(Boolean)
    .join(" and ")
  const showAllMatches = () => {
    setHealthState("all")
    setClientState(null)
    writeUrl({ health: "all", clientId: null })
    focusSearch()
  }

  // "Select all shown" adds the shown listings to the selection (and clearing
  // it removes only them), so a filter never silently drops a listing picked
  // under another filter. It is offered only while the result stays within
  // the cap: the selection is explicit ids and is never trimmed to fit.
  const visibleIds = visible.map((row) => row.entry.id)
  const shownSelected = visibleIds.filter((id) => selected.has(id)).length
  const hiddenSelected = selected.size - shownSelected
  const unlinkedSelected = rows.filter(
    (row) => selected.has(row.entry.id) && !row.entry.linked
  ).length
  const unionSize = selected.size + visibleIds.length - shownSelected
  const allShownSelected =
    visibleIds.length > 0 && shownSelected === visibleIds.length
  const selectAllBlocked = !allShownSelected && unionSize > BULK_MAX_TARGETS
  const selectAllName = `Select all shown (${formatNumber(visible.length)})`
  const setAllShown = (on: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      for (const id of visibleIds) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return on && next.size > BULK_MAX_TARGETS ? current : next
    })

  const renderRow = (row: BoardRow) => {
    const address = formatAddressLine(row.entry.address)
    const unfiledRow = row.clientId === UNFILED
    // The phone row names the client before the address ("Client ·
    // address"); a desk has its own Client column, so this part is phone
    // only. An unfiled row keeps its Client cell on the phone instead.
    const clientInSubtitle = !business && !unfiledRow
    const capped =
      !selected.has(row.entry.id) && selected.size >= BULK_MAX_TARGETS
    return (
      <TableRow key={row.entry.id} interactive className="relative">
        {canSelect ? (
          <TableCell priority="select">
            {/* Above the row's stretched link, so a tap here selects. */}
            <span className="relative z-raised flex">
              <Checkbox
                checked={selected.has(row.entry.id)}
                disabled={capped}
                // Why it is off: the bar's "50 selected (the most one
                // change can cover)".
                aria-describedby={capped ? selectionStatusId : undefined}
                onCheckedChange={(checked) =>
                  toggle(row.entry.id, checked === true)
                }
                aria-label={`Select ${row.entry.name} for a bulk change`}
              />
            </span>
          </TableCell>
        ) : null}
        <TableCell priority="primary">
          <span className="flex min-w-0 flex-col">
            {/* The whole row is this link's target: its ::after stretches
                over the row (positioned), so a phone row is one tap and
                never a 24px line of text. No chevron of its own: the row is
                `interactive`, so the record card already draws one. From
                `lg` a click on the rest of the row (the ::after, whose clicks
                land on the link itself) opens the quick look; the name is
                raised above the ::after, so a click on it opens the listing
                (DSK-23). */}
            <ShellLink
              href={listingHref(row.entry.id)}
              onClick={(event) => {
                if (event.target === event.currentTarget)
                  quick.intercept(event, row)
              }}
              className="inline-flex min-h-(--np-control-h) items-center rounded-(--np-radius-tag) font-semibold break-words text-ink underline-offset-4 focus-halo after:absolute after:inset-0 after:content-[''] hover:underline @max-3xl/table:min-h-0 @max-3xl/table:text-body"
            >
              <span data-slot="row-name" className="relative z-raised">
                {row.entry.name}
              </span>
            </ShellLink>
            {clientInSubtitle || address ? (
              <span className="text-caption break-words text-ink-muted">
                {clientInSubtitle ? (
                  <span className={PHONE.onlyInline}>
                    {row.clientName}
                    {address ? " · " : null}
                  </span>
                ) : null}
                {address}
              </span>
            ) : null}
          </span>
        </TableCell>
        {business ? null : unfiledRow ? (
          // Unfiled: the one thing this listing needs, so it stays on the
          // phone row as a labelled line under the record.
          <TableCell priority="detail" label="Client" span>
            {canManage ? (
              <span className="relative z-raised inline-flex max-w-full">
                <FileUnderClient
                  locationId={row.entry.id}
                  locationName={row.entry.name}
                />
              </span>
            ) : (
              <span className="text-ink-muted">Not filed</span>
            )}
          </TableCell>
        ) : (
          <TableCell priority="desk-only">
            <span className="flex min-w-0 items-center gap-2">
              <ClientAvatar name={row.clientName} colour={null} size="sm" />
              <span className="min-w-0 break-words">{row.clientName}</span>
            </span>
          </TableCell>
        )}
        {/* On the phone the health pill closes the subtitle line. */}
        <TableCell priority="trailing" className="@max-3xl/table:self-end">
          <span className="flex flex-col items-start gap-1 @max-3xl/table:items-end">
            {/* While the summaries are still loading, "Not checked" would
                contradict the "Checking each listing…" announcement, so the
                pill waits. A health known without a summary still shows. */}
            {summaries.isPending && row.health === "unchecked" ? null : (
              <StatusPill tone={listingHealthTone(row.health)}>
                {listingHealthLabel(row.health)}
              </StatusPill>
            )}
            <span className={PHONE.wide}>
              <FreshnessLine summary={row.summary} />
            </span>
          </span>
        </TableCell>
        {/* An unlinked listing has nothing to check: off the phone line. */}
        <TableCell
          priority={row.entry.linked ? "meta" : "desk-only"}
          label="Completeness"
        >
          <CompletenessCell
            completeness={row.completeness}
            linked={row.entry.linked}
            pending={completeness.isPending}
          />
        </TableCell>
        <TableCell priority="meta">
          {summaries.isPending ? (
            <Skeleton className="h-3.5 w-24 @3xl/table:h-5.5 @3xl/table:w-32" />
          ) : quietRow(row.summary) ? (
            // One node at every width: a quiet row says so once, not once
            // per layout (the phone figure and the pills would repeat it).
            <span className="text-caption text-ink-muted @3xl/table:text-ui">
              {row.summary ? "Nothing waiting" : "—"}
            </span>
          ) : (
            <>
              <span className={PHONE.wide}>
                <PendingChips summary={row.summary} />
              </span>
              <span className={PHONE.only}>
                <WaitingFigure summary={row.summary} />
              </span>
            </>
          )}
        </TableCell>
        <TableCell priority="desk-only">
          <VerificationCell row={row} />
        </TableCell>
        <TableCell priority="desk-only">
          {summaries.isPending ? (
            <Skeleton className="h-3.5 w-20" />
          ) : (
            <span className="text-caption text-ink-muted tabular-nums">
              {/* No summary means we don't know, not that it never happened. */}
              {!row.summary ? (
                "—"
              ) : row.summary.lastPublish ? (
                <RelativeTime iso={row.summary.lastPublish.at} />
              ) : (
                "Never"
              )}
            </span>
          )}
        </TableCell>
      </TableRow>
    )
  }

  const healthCount = (filter: HealthFilter) =>
    inScope.filter((row) => matchesHealth(row.health, filter)).length

  return (
    <div className="flex flex-col gap-4">
      {/* The toolbar (Drop 1 `Toolbar`): the search pill on its own row,
          full width at every size, so it never shares a 320px row with the
          order control. On a phone, focusing it is Notion Mail's search
          takeover (a "Cancel" that clears the query). Not sticky: the chips
          and the summary under it scroll with the board. */}
      <div className="flex min-w-0 flex-col gap-3">
        <Toolbar
          sticky={false}
          className="bg-transparent py-0"
          searchLabel="Search listings"
          searchPlaceholder={
            business ? "Search listings" : "Search listings or clients"
          }
          searchValue={search}
          onSearchChange={setSearch}
        />
        {/* Two chip strips (health with the order chip, then clients).
            Each strip is its own FilterChipStrip so each keeps ITS pressed
            chip in view: on a phone a strip scrolls sideways (edge fade)
            rather than truncating a label; from md it wraps, so a desk sees
            every chip. Each chip is a 44px target on touch. A health chip
            with nothing in it is not drawn, unless it is the one chosen (so
            it can be left) or "All". */}
        <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-x-3">
          <FilterChipStrip className="-mx-5 px-5 md:mx-0 md:flex-wrap md:px-0.5">
            <div
              role="group"
              aria-label="Filter by health"
              className="flex shrink-0 gap-1.5 md:shrink md:flex-wrap md:gap-y-4 desk:gap-y-1.5"
            >
              {HEALTH_FILTERS.map((filter) => (
                <FilterChip
                  key={filter.value}
                  pressed={health === filter.value}
                  onClick={() => setHealth(filter.value)}
                  count={formatNumber(healthCount(filter.value))}
                  hideWhenZero={filter.value !== "all"}
                >
                  {filter.label}
                </FilterChip>
              ))}
            </div>
            {/* Its own menu, so choosing an order never re-filters the
                board or moves the pressed chip. */}
            <OrderChip
              value={order}
              onChange={setOrder}
              business={business}
              className="md:ml-auto"
            />
          </FilterChipStrip>
          {clientChips.length > 1 ? (
            <FilterChipStrip className="-mx-5 px-5 md:mx-0 md:flex-wrap md:border-l md:border-line md:px-0.5 md:pl-3">
              <div
                role="group"
                aria-label="Filter by client"
                className="flex shrink-0 gap-1.5 md:shrink md:flex-wrap md:gap-y-4 desk:gap-y-1.5"
              >
                <FilterChip
                  pressed={clientFilter === null}
                  onClick={() => setClientFilter(null)}
                  count={formatNumber(rows.length)}
                >
                  All clients
                </FilterChip>
                {clientChips.map((chip) => {
                  const pressed = clientFilter === chip.id
                  return (
                    <FilterChip
                      key={chip.id}
                      pressed={pressed}
                      onClick={() => setClientFilter(pressed ? null : chip.id)}
                      count={formatNumber(chip.count)}
                    >
                      {chip.id === UNFILED ? (
                        <CircleAlertIcon aria-hidden strokeWidth={1.75} />
                      ) : null}
                      {chip.name}
                    </FilterChip>
                  )
                })}
              </div>
            </FilterChipStrip>
          ) : null}
        </div>
        {/* The count line, spoken rather than drawn: a polite live region
            that announces "Checking each listing…" while the summaries load,
            then how many listings a filter leaves, out of all of them, and
            how healthy they all are. It is drawn only when the check of what
            is waiting failed, so that is never silent on screen, with "Check
            again" beside it (outside the live region, so the line is what is
            read). The wrapper is always there, and draws no box of its own
            until then, so the live region is never remounted. */}
        <div
          className={
            summaries.isError
              ? "flex flex-wrap items-center gap-x-2"
              : "contents"
          }
        >
          <p
            className={
              summaries.isError ? "text-caption text-ink-muted" : "sr-only"
            }
            aria-live="polite"
          >
            {summaries.isPending ? (
              "Checking each listing…"
            ) : (
              <>
                <span className="tabular-nums">
                  {visible.length !== rows.length
                    ? `${formatNumber(visible.length)} of ${formatNumber(rows.length)} ${rows.length === 1 ? "listing" : "listings"} shown`
                    : rows.length === 1
                      ? "1 listing"
                      : `${formatNumber(rows.length)} listings`}
                </span>
                {" · "}
                <span>
                  {summariseListingHealth(rows.map((row) => row.health))}
                </span>
                {summaries.isError ? (
                  <span>
                    {/* After a failed refresh the last check is still on
                        screen; only a first read that failed has nothing. */}
                    {summaries.data
                      ? ". We couldn’t refresh what is waiting; this is the last check."
                      : ". We couldn’t check what is waiting on each listing."}
                  </span>
                ) : (
                  <span>.</span>
                )}
              </>
            )}
          </p>
          {summaries.isError ? (
            <Button
              variant="ghost"
              size="sm"
              pending={summaries.isFetching}
              pendingLabel="Checking again…"
              onClick={() => {
                summaryRetry.current = true
                void summaries.refetch()
              }}
            >
              <RefreshCwIcon aria-hidden />
              Check again
            </Button>
          ) : null}
        </div>
      </div>

      {visible.length === 0 ? (
        <Empty
          framed
          illustration={<EmptyIllustration name="search" />}
          title={
            needle
              ? `No listings match “${search.trim()}”`
              : "No listings match"
          }
          description={
            !needle
              ? `No listing is in ${scope} right now.`
              : narrowed && searchMatches > 0
                ? `${formatNumber(searchMatches)} ${searchMatches === 1 ? "listing matches" : "listings match"} outside ${scope}.`
                : "Check the spelling, or clear the search to see every listing."
          }
          action={
            needle && narrowed && searchMatches > 0 ? (
              <>
                <Button variant="secondary" onClick={showAllMatches}>
                  {searchMatches === 1
                    ? "Show 1 match"
                    : `Show ${formatNumber(searchMatches)} matches`}
                </Button>
                <Button variant="ghost" onClick={clearFilters}>
                  Clear filters
                </Button>
              </>
            ) : (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            )
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {selectAllBlocked ? (
            // Why select-all is off, in words at every width: the header
            // cell is a narrow column on a desk, so the reason sits above
            // the table and describes the checkbox.
            <p
              id={selectAllReasonId}
              className="px-1 text-caption text-ink-muted"
            >
              One bulk change covers at most {BULK_MAX_TARGETS} listings. Narrow
              the board or select listings one by one.
            </p>
          ) : null}
          <BoardTable
            selectable={canSelect}
            selectAll={
              canSelect ? (
                <>
                  <Checkbox
                    ref={selectAllRef}
                    aria-label={selectAllName}
                    aria-describedby={
                      selectAllBlocked ? selectAllReasonId : undefined
                    }
                    checked={allShownSelected}
                    indeterminate={!allShownSelected && shownSelected > 0}
                    disabled={selectAllBlocked}
                    onCheckedChange={(checked) => setAllShown(checked === true)}
                  />
                  {/* The record cards' select-all bar: the words start with
                      the checkbox's own name (WCAG 2.5.3 label in name). */}
                  <TableSelectAllLabel>
                    {selected.size > 0
                      ? `${selectAllName} · ${formatNumber(selected.size)} selected`
                      : selectAllName}
                  </TableSelectAllLabel>
                </>
              ) : undefined
            }
          >
            {!business && unfiled.length > 0 ? (
              <TableRow group>
                <TableCell colSpan={COLUMNS.length + (canSelect ? 1 : 0)}>
                  Not filed under a client · {formatNumber(unfiled.length)}
                </TableCell>
              </TableRow>
            ) : null}
            {unfiled.map(renderRow)}
            {!business && unfiled.length > 0 && filed.length > 0 ? (
              <TableRow group>
                <TableCell colSpan={COLUMNS.length + (canSelect ? 1 : 0)}>
                  Filed under a client · {formatNumber(filed.length)}
                </TableCell>
              </TableRow>
            ) : null}
            {filed.map(renderRow)}
          </BoardTable>
        </div>
      )}
      {quick.item ? (
        <ListingQuickLook
          // The latest state of the listing, if it is still on the board.
          row={
            rows.find((row) => row.entry.id === quick.item?.entry.id) ??
            quick.item
          }
          business={business}
          canManage={canManage}
          now={now}
          summaryPending={summaries.isPending}
          summaryFailed={summaries.isError && !summaries.data}
          {...quick.panelProps}
        />
      ) : null}
      {/* Owners and admins only, as the header action it replaces was. At
          the end of the list so the first listing is not pushed down by it. */}
      {canManage ? (
        <div>
          <AddListingsLink clientId={addClientId} />
        </div>
      ) : null}
      {/* Docked to the bottom of a phone (the tab bar steps aside for it,
          see the chrome contract in globals.css), riding the keyboard, with
          a spacer that keeps the last listing reachable above it; sticky
          under the board on a desk. Only there while something is
          selected, so there is one bottom bar at a time. */}
      <ActionBar
        dock
        visible={canSelect && selected.size > 0}
        label="Bulk change selection"
        offset="bottom-3"
        safeArea={false}
        statusRow={hiddenSelected > 0 && unlinkedSelected > 0}
        status={
          // Also the description of a row checkbox the cap has switched off.
          <span id={selectionStatusId}>
            <span className="font-semibold tabular-nums">
              {formatNumber(selected.size)}
            </span>{" "}
            selected
            {selected.size >= BULK_MAX_TARGETS ? (
              <ActionBarMuted> (the most one change can cover)</ActionBarMuted>
            ) : null}
            {/* What the count covers that the board does not show, or that
                Google cannot be changed for. What a change then skips is
                the preview's to say, from the server. */}
            {hiddenSelected > 0 ? (
              <ActionBarMuted>
                {` · ${formatNumber(hiddenSelected)} not shown`}
              </ActionBarMuted>
            ) : null}
            {unlinkedSelected > 0 ? (
              <ActionBarMuted>
                {` · ${formatNumber(unlinkedSelected)} not linked to Google`}
              </ActionBarMuted>
            ) : null}
          </span>
        }
        actions={
          <>
            <Button
              variant="ghost-dark"
              size="sm"
              onClick={() => {
                setSelected(new Set())
                // The bar (and this button) goes with the selection, so focus
                // returns to the control that starts a new one, or the page.
                requestAnimationFrame(() => {
                  selectAllRef.current?.focus()
                  if (document.activeElement !== selectAllRef.current)
                    document.getElementById("main")?.focus()
                })
              }}
            >
              Clear selection
            </Button>
            <Link
              href={`/listings/bulk?ids=${[...selected].join(",")}`}
              className={buttonVariants({ size: "sm" })}
            >
              Prepare bulk change
            </Link>
          </>
        }
      />
    </div>
  )
}

export { ListingsBoard }
