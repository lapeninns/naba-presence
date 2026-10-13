"use client"

import {
  CheckIcon,
  ChevronDownIcon,
  DownloadIcon,
  ExternalLinkIcon,
  GlobeIcon,
  History,
  InfoIcon,
  LayoutListIcon,
  MoreHorizontalIcon,
  SendIcon,
  ShieldCheckIcon,
  UploadIcon,
} from "lucide-react"
import Link from "next/link"
import * as React from "react"

import { PageFrame } from "@/components/app-shell/page-frame"
import { useQueryClient } from "@tanstack/react-query"

import { ActivityDrawer } from "@/components/editors/activity-drawer"
import {
  EditorStatusProvider,
  editorStatusPill,
  useEditorStatus,
} from "@/components/editors/editor-status"
import { ListingGate } from "@/components/listings/listing-gate"
import { SiblingSwitcher } from "@/components/listings/sibling-switcher"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import { TabNav } from "@/components/ui/tabs"
import type { ListingSummary } from "@/lib/contracts/location-summary"
import { formatNumber } from "@/lib/format"
import {
  listingAreaNavItems,
  listingPageLabel,
  type ListingAreaNavItem,
  type ListingPageKey,
} from "@/lib/listings/area-nav"
import { areaState } from "@/lib/listings/area-state"
import { googleUnreachable, unpublishedCount } from "@/lib/listings/health"
import {
  listingArea,
  listingHref,
  modelNote,
  type ListingAreaKey,
  type ListingAreaModel,
} from "@/lib/listings/areas"
import type { LocationCapabilities } from "@/lib/locations/gating"
import type { DirectoryEntry } from "@/lib/queries/use-locations"
import { queryKeys } from "@/lib/queries/keys"
import { useListingSummary } from "@/lib/queries/use-listing-summary"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { cn } from "@/lib/utils"
import { useWorkspaceMode } from "@/lib/workspace/mode"

/**
 * The gutters and bottom padding of PageFrame, negated and then restored as
 * padding on the scrolling pane: an editor's sticky footer bleeds to the
 * pane's edges (its own negative margins mirror these), and `overflow-y-auto`
 * would otherwise clip that bleed. Only where the pane scrolls (md and up);
 * a phone's footer is docked to the screen edge, outside the flow.
 */
const PANE_BLEED =
  "-mx-5 -mb-6 px-5 pb-6 md:-mx-(--np-page-pad-x) md:-mb-(--np-page-pad-y) md:px-(--np-page-pad-x) md:pb-(--np-page-pad-y)"

const MODEL_ICON: Record<
  ListingAreaModel,
  React.ComponentType<{
    className?: string
    strokeWidth?: number
    "aria-hidden"?: boolean
  }>
> = {
  canonical: ShieldCheckIcon,
  google_direct: GlobeIcon,
  lifecycle: SendIcon,
  reviewed: ShieldCheckIcon,
  inbound: DownloadIcon,
}

export type { ListingPageKey }

/** A link the header offers beside Activity ("Open on Google"). */
export type ListingHeaderLink = {
  label: string
  href: string
  /** Opens in a new tab (another site). */
  external?: boolean
}

/**
 * The count after a nav item's label, with its noun for assistive tech. A
 * `count` badge: the figure is set in the count type role.
 */
function NavCount({ item }: { item: ListingAreaNavItem }) {
  if (item.count <= 0) return null
  return (
    <Badge variant={item.key === "changes" ? "secondary" : "warning"} count>
      <span aria-hidden>{formatNumber(item.count)}</span>
      <span className="sr-only">
        , {formatNumber(item.count)} {item.countNoun}
      </span>
    </Badge>
  )
}

/**
 * The desk's area tabs: the shared item list as a scrolling tab row, Review
 * & publish last. TabNav owns the strip: the edge fades, and scrolling the
 * current tab into view (along the row only) on mount and on every route
 * change. An area this listing can't use is drawn muted with its reason
 * (TabNav's `unavailableReason`) and is NOT `disabled`: it still opens, to
 * look, exactly as the phone's area list does (listings-content-07).
 */
function ListingAreaTabs({ items }: { items: ListingAreaNavItem[] }) {
  return (
    <TabNav
      aria-label="Listing areas"
      items={items.map((item) => ({
        href: item.href,
        label: item.label,
        current: item.current,
        unavailableReason: item.unavailableReason,
        badge: <NavCount item={item} />,
      }))}
      className="hidden lg:block"
      data-slot="listing-area-tabs"
    />
  )
}

/**
 * The same items as one compact control under the desk's tab width: a
 * button naming the current page that opens the area list (an action sheet
 * on a phone). Every row is a real link, so the editor's leave guard catches
 * it. Unavailable areas get the tab row's treatment: muted, with the reason,
 * and still open.
 */
function AreaSwitcher({
  items,
  className,
}: {
  items: ListingAreaNavItem[]
  className?: string
}) {
  const current = items.find((item) => item.current)
  const label = current?.label ?? "Overview"
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-slot="listing-area-selector"
        render={
          <Button
            variant="secondary"
            className={cn("min-w-0 justify-between", className)}
          />
        }
        aria-label={`Listing area: ${label}`}
      >
        <LayoutListIcon aria-hidden strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <ChevronDownIcon aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" title="Listing areas">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.href}
            render={
              <Link
                href={item.href}
                aria-current={item.current ? "page" : undefined}
                data-unavailable={item.unavailableReason ? true : undefined}
              />
            }
            className={cn(item.unavailableReason && "items-start py-1.5")}
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span
                className={cn(
                  item.unavailableReason && "font-normal text-ink-muted"
                )}
              >
                {item.label}
              </span>
              {item.unavailableReason ? (
                <span className="text-caption text-ink-muted">
                  <span className="sr-only">Unavailable: </span>
                  {item.unavailableReason}
                </span>
              ) : null}
            </span>
            <NavCount item={item} />
            {item.current ? <CheckIcon aria-hidden /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Where a change made in this area goes, on a phone: one tap away behind an
 * info button instead of two or three lines above the editor. The desk
 * shows the same sentence as a line under the tabs.
 */
function ModelNoteInfo({
  area,
  className,
}: {
  area: { key: ListingAreaKey; model: ListingAreaModel; label: string }
  className?: string
}) {
  return (
    <Popover>
      <PopoverTrigger
        data-slot="model-note-trigger"
        render={
          <Button
            variant="secondary"
            size="icon"
            aria-label="Where changes go"
            className={className}
          />
        }
      >
        <InfoIcon aria-hidden strokeWidth={1.75} />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        title={`Where ${area.label.toLowerCase()} changes go`}
      >
        <p data-slot="model-note" className="text-body text-ink-secondary">
          {modelNote(area.model, area.key)}
        </p>
      </PopoverContent>
    </Popover>
  )
}

/**
 * "Review & publish (n)", for every page of a listing while edits saved
 * here are waiting, so the way to publish them is never only on the
 * overview. Hidden while the Google login is broken (nothing can go out).
 *
 * Secondary: the one primary publishing action on an area is the editor's
 * "Review changes".
 */
function ReviewPublishLink({
  locationId,
  summary,
  className,
}: {
  locationId: string
  summary: ListingSummary | undefined
  className?: string
}) {
  if (!summary || googleUnreachable(summary)) return null
  const pending = unpublishedCount(summary)
  if (pending === 0) return null
  return (
    <Link
      href={listingHref(locationId, "changes")}
      data-slot="review-publish-link"
      className={cn(buttonVariants({ variant: "secondary" }), className)}
    >
      <UploadIcon aria-hidden strokeWidth={1.75} />
      Review & publish ({formatNumber(pending)})
    </Link>
  )
}

/**
 * The phone's overflow: everything the desk shows as header buttons
 * (the page's links, Review & publish, Activity) in one menu, so the header
 * keeps to three short rows.
 */
function HeaderOverflow({
  locationId,
  summary,
  links,
  onActivity,
  triggerRef,
  className,
}: {
  locationId: string
  summary: ListingSummary | undefined
  links: ListingHeaderLink[]
  onActivity: () => void
  triggerRef: React.RefObject<HTMLButtonElement | null>
  className?: string
}) {
  const pending =
    summary && !googleUnreachable(summary) ? unpublishedCount(summary) : 0
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        ref={triggerRef}
        data-slot="listing-header-overflow"
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="More listing actions"
            className={cn("shrink-0", className)}
          />
        }
      >
        <MoreHorizontalIcon aria-hidden strokeWidth={1.75} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" title="Listing">
        {links.map((link) => (
          <DropdownMenuItem
            key={link.href}
            render={
              link.external ? (
                <a href={link.href} target="_blank" rel="noreferrer" />
              ) : (
                <Link href={link.href} />
              )
            }
          >
            <ExternalLinkIcon aria-hidden />
            {link.label}
            {link.external ? (
              <span className="sr-only"> (opens in a new tab)</span>
            ) : null}
          </DropdownMenuItem>
        ))}
        {pending > 0 ? (
          <DropdownMenuItem
            render={<Link href={listingHref(locationId, "changes")} />}
          >
            <UploadIcon aria-hidden />
            Review & publish ({formatNumber(pending)})
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={onActivity}>
          <History aria-hidden />
          Activity
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The shared head of every listing page.
 *
 * Phone (under 48rem), three short rows so the editor starts above the
 * fold: the listing's name as the switcher to its sibling listings (the
 * client's name on the overview) with a "⋯" menu holding the page's links,
 * Review & publish and Activity; the page title in the serif with ONE
 * status pill; and one area button opening the area list, beside an info
 * button that says where a change made here goes.
 *
 * Desk adds the client as a caption, the description, the header buttons,
 * the tab row from 64rem and the model note as a line.
 *
 * `status` is the pill beside the title. Pass `undefined` to show a
 * placeholder while it loads and `null` for none.
 */
function ListingAreaHeader({
  entry,
  role,
  locationId,
  current,
  summary,
  caps,
  status,
  description,
  actions,
  links = [],
}: {
  entry: DirectoryEntry
  role: string | null
  locationId: string
  current: ListingPageKey
  summary: ListingSummary | undefined
  caps?: LocationCapabilities
  status: React.ReactNode | undefined
  description?: React.ReactNode
  /** Extra header controls; drawn on wider screens only. */
  actions?: React.ReactNode
  /** Header links: buttons on wider screens, rows of the phone's "⋯" menu. */
  links?: ListingHeaderLink[]
}) {
  const business = useWorkspaceMode() === "business"
  const canManageConsoles = role === "owner" || role === "admin"
  const area =
    current === "overview" || current === "changes"
      ? null
      : listingArea(current)
  const ModelIcon = area ? MODEL_ICON[area.model] : null
  const title = current === "overview" ? entry.name : listingPageLabel(current)
  const nested = current !== "overview"
  const clientLabel = business
    ? "Listing"
    : (entry.clientName ?? "Not filed under a client")
  const items = listingAreaNavItems({
    locationId,
    current,
    canManageConsoles,
    summary,
    caps,
    linked: entry.linked,
  })
  const [activityOpen, setActivityOpen] = React.useState(false)
  const overflowRef = React.useRef<HTMLButtonElement>(null)

  // The line above the title: the listing's name on an area (the way back to
  // its overview, and the switcher to its siblings), the client on the
  // overview (the switcher there).
  const context = nested ? (
    <SiblingSwitcher
      current={entry}
      role={role}
      className="text-title font-semibold"
      fallback={
        <Link
          href={listingHref(locationId)}
          data-slot="listing-name"
          className="inline-flex min-h-(--np-control-h) max-w-full min-w-0 items-center rounded-(--np-radius-tag) text-title font-semibold text-ink underline-offset-3 focus-halo hover:underline"
        >
          <span className="truncate">{entry.name}</span>
        </Link>
      }
    />
  ) : (
    <SiblingSwitcher
      current={entry}
      role={role}
      className="text-ui font-medium text-ink-secondary"
      fallback={
        <p className="flex min-h-(--np-control-h) min-w-0 items-center text-ui font-medium text-ink-muted md:min-h-0">
          <span className="truncate">{clientLabel}</span>
        </p>
      }
    >
      {clientLabel}
    </SiblingSwitcher>
  )

  return (
    <header
      data-slot="listing-area-header"
      className="flex shrink-0 flex-col gap-2 md:gap-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 grow basis-80 flex-col md:gap-1">
          {nested ? (
            <p className="hidden text-caption font-medium text-ink-muted md:block">
              {clientLabel}
            </p>
          ) : null}
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="flex min-w-0">{context}</div>
            <HeaderOverflow
              locationId={locationId}
              summary={summary}
              links={links}
              onActivity={() => setActivityOpen(true)}
              triggerRef={overflowRef}
              className="md:hidden"
            />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="min-w-0 font-display text-page-title font-semibold text-balance break-words text-ink">
              {title}
            </h1>
            {status === undefined ? (
              <Skeleton
                className="h-5 w-28 rounded-(--np-radius-tag)"
                aria-hidden
              />
            ) : (
              status
            )}
          </div>
          {area ? (
            <p className="hidden text-ui text-pretty text-ink-muted md:block">
              {area.description}
            </p>
          ) : description ? (
            <p className="mt-1 max-w-(--np-measure-reading) text-ui text-pretty text-ink-muted md:mt-0">
              {description}
            </p>
          ) : null}
        </div>
        <div className="hidden flex-wrap items-center justify-end gap-2 md:ml-auto md:flex">
          {actions}
          {links.map((link) =>
            link.external ? (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: "secondary" })}
              >
                <ExternalLinkIcon aria-hidden />
                {link.label}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              <Link
                key={link.href}
                href={link.href}
                className={buttonVariants({ variant: "secondary" })}
              >
                {link.label}
              </Link>
            )
          )}
          {current === "changes" ? null : (
            // From lg the tab row's "Review & publish" tab carries the
            // count, so the button would be a second entry to the same page.
            <ReviewPublishLink
              locationId={locationId}
              summary={summary}
              className="lg:hidden"
            />
          )}
          <ActivityDrawer
            locationId={locationId}
            open={activityOpen}
            onOpenChange={setActivityOpen}
            returnFocus={overflowRef}
          />
        </div>
      </div>

      {/* Under the tab row's width: one area button (not on the overview,
          whose cards are the area list) and, on a phone, the model note
          behind an info button. */}
      {nested ? (
        <div className="flex items-center gap-2 lg:hidden">
          <AreaSwitcher items={items} className="flex-1 md:flex-none" />
          {area ? <ModelNoteInfo area={area} className="md:hidden" /> : null}
        </div>
      ) : null}
      <ListingAreaTabs items={items} />

      {area && ModelIcon ? (
        <p
          data-slot="model-note"
          className="hidden items-start gap-2 text-ui text-ink-secondary md:flex"
        >
          <ModelIcon
            className="mt-0.5 size-4 shrink-0 text-ink-muted"
            strokeWidth={1.75}
            aria-hidden
          />
          <span>{modelNote(area.model, area.key)}</span>
        </p>
      ) : null}
    </header>
  )
}

/** The pill an area's header shows: the same words its overview card shows. */
function AreaStatusPill({
  area,
  summary,
}: {
  area: ListingAreaKey
  summary: ListingSummary
}) {
  const state = areaState(area, summary)
  return <StatusPill tone={state.tone}>{state.label}</StatusPill>
}

/**
 * One area of a listing, as a focused page.
 *
 * The header says which listing this is, names the area, shows the same
 * status its card showed on the overview (so opening an editor never changes
 * the story), carries the area navigation, and says where a change made
 * here goes. On a desk the editor below scrolls in its own pane so an
 * editor's pinned footer stays on screen; on a phone the page scrolls and
 * the footer docks to the bottom edge once there is something to save.
 *
 * Props are stable for the editors that render inside it: `locationId`,
 * `role`, `area`, `children`. `actions` (extra header buttons, before
 * Activity; wider screens only) and `status` (replaces the summary pill;
 * `null` hides it) are optional.
 */
function AreaFrame(props: {
  locationId: string
  role: string | null
  area: ListingAreaKey
  actions?: React.ReactNode
  status?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <EditorStatusProvider>
      <AreaFrameBody {...props} />
    </EditorStatusProvider>
  )
}

function AreaFrameBody({
  locationId,
  role,
  area: areaKey,
  actions,
  status,
  children,
}: {
  locationId: string
  role: string | null
  area: ListingAreaKey
  actions?: React.ReactNode
  status?: React.ReactNode
  children: React.ReactNode
}) {
  const summary = useListingSummary(locationId)
  const caps = useLocationCapabilities(locationId)
  const editor = useEditorStatus()
  // An editor's "In sync" is a claim about Google; while Google can't be
  // reached for this listing the summary's "Unknown" speaks instead.
  const reported = editorStatusPill(editor)
  const editorPill =
    reported && reported.tone === "healthy" && googleUnreachable(summary.data)
      ? null
      : reported

  // The summary is DB-only and nothing else refreshes it while an editor is
  // open. When the editor's state moves (edits saved here, published,
  // discarded), read it again so the fallback pill is current once the
  // editor has nothing of its own to say.
  const queryClient = useQueryClient()
  const editorSignature = editor
    ? `${editor.status}|${editor.isDirty}|${editor.localEdits}`
    : null
  const lastSignature = React.useRef(editorSignature)
  React.useEffect(() => {
    if (lastSignature.current === editorSignature) return
    const first = lastSignature.current === null
    lastSignature.current = editorSignature
    if (first || editorSignature === null) return
    void queryClient.invalidateQueries({
      queryKey: queryKeys.listingSummary(locationId),
    })
  }, [editorSignature, locationId, queryClient])

  const pill =
    status !== undefined ? (
      status
    ) : areaKey === "verification" ? null : editorPill ? (
      <StatusPill tone={editorPill.tone} data-slot="area-editor-status">
        {editorPill.label}
      </StatusPill>
    ) : summary.data ? (
      <AreaStatusPill area={areaKey} summary={summary.data} />
    ) : summary.isError ? null : undefined

  return (
    <ListingGate locationId={locationId} role={role}>
      {(entry) => (
        <PageFrame width="workspace">
          <ListingAreaHeader
            entry={entry}
            role={role}
            locationId={locationId}
            current={areaKey}
            summary={summary.data}
            caps={caps.data}
            status={pill}
            actions={actions}
          />

          {/* The scrolling pane: where PageFrame width="workspace" locks
              <main> to the viewport (768 wide and 620 tall), the editor
              scrolls here and its footer pins to the pane's bottom edge.
              Below that the pane is not a scroller: the page scrolls with
              the column, as PageFrame intends, and a phone's footer docks
              to the screen's bottom edge instead. */}
          <div
            className={cn(
              "flex flex-col gap-6 md:[@media(min-height:620px)]:min-h-0 md:[@media(min-height:620px)]:flex-1 md:[@media(min-height:620px)]:overflow-y-auto",
              PANE_BLEED
            )}
          >
            {children}
          </div>
        </PageFrame>
      )}
    </ListingGate>
  )
}

export { AreaFrame, AreaStatusPill, ListingAreaHeader, ReviewPublishLink }
