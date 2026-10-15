"use client"

import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  DownloadIcon,
  ExternalLinkIcon,
  GlobeIcon,
  History,
  InfoIcon,
  MoreHorizontalIcon,
  SendIcon,
  ShieldCheckIcon,
  UploadIcon,
} from "lucide-react"
import Link from "next/link"
import { useSelectedLayoutSegment } from "next/navigation"
import * as React from "react"

import { PageFrame } from "@/components/app-shell/page-frame"
import { ShellLink } from "@/components/app-shell/shell-link"
import { useQueryClient } from "@tanstack/react-query"

import { ActivityDrawer } from "@/components/editors/activity-drawer"
import {
  GoogleFreshnessFailure,
  GoogleFreshnessLine,
  GoogleFreshnessSlot,
  useGoogleFreshnessReport,
  type GoogleFreshnessReport,
} from "@/components/editors/google-freshness"
import {
  EditorStatusProvider,
  editorStatusPill,
  useEditorStatus,
} from "@/components/editors/editor-status"
import { InAreaFrameContext } from "@/components/listings/area-frame-context"
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
  areaForSegment,
  listingArea,
  listingHref,
  modelNote,
  type ListingAreaKey,
  type ListingAreaModel,
} from "@/lib/listings/areas"
import type { LocationCapabilities } from "@/lib/locations/gating"
import type { DirectoryEntry } from "@/lib/queries/use-locations"
import { queryKeys } from "@/lib/queries/keys"
import { useMediaQuery } from "@/lib/hooks/use-media-query"
import { mediaQuery } from "@/lib/ui/breakpoints"
import { useListingSummary } from "@/lib/queries/use-listing-summary"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { cn } from "@/lib/utils"
import { useWorkspaceMode } from "@/lib/workspace/mode"
import { useNow } from "@/lib/time/server-now"

/**
 * The gutters and bottom padding of PageFrame, negated and then restored as
 * padding on the scrolling pane: an editor's sticky footer bleeds to the
 * pane's edges (its own negative margins mirror these), and `overflow-y-auto`
 * would otherwise clip that bleed. Only where the pane scrolls (md and up);
 * a phone's footer is docked to the screen edge, outside the flow.
 */
/** Where the editor pane is a scroller (matches its md + 620px tall classes). */
const PANE_SCROLLS_QUERY = `${mediaQuery("md")} and (min-height: 620px)`

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
 * The desk's area tabs: the shared item list as one row from 64rem. Tabs
 * that don't fit move into a "More" menu (P04's overflow) instead of hiding
 * behind a fade. Review & publish is not a tab: it is a header action, so
 * it never scrolls out of reach (DSK-01). An area this listing can't use is
 * drawn muted with its reason (TabNav's `unavailableReason`) and is NOT
 * `disabled`: it still opens, to look, exactly as the phone's area list does
 * (listings-content-07).
 */
function ListingAreaTabs({ items }: { items: ListingAreaNavItem[] }) {
  return (
    <TabNav
      aria-label="Listing areas"
      overflow="more"
      moreLabel="More areas"
      // On every page of the listing: viewport prefetch fetched each area's
      // route on each load (MEA-04). Intent only, as the shell's links do.
      prefetch="intent"
      items={items
        .filter((item) => item.key !== "changes")
        .map((item) => ({
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
 * The page title as the area switcher (LST-06): the H1's words open the
 * area list (an action sheet on a phone), so no second row repeats the
 * title. Every row is a real link, so the editor's leave guard catches it.
 * Unavailable areas get the tab row's treatment: muted, with the reason,
 * and still open. The trigger says what it does through its menu role, so
 * the heading's name stays the area's name.
 */
function AreaTitleSwitcher({
  items,
  title,
}: {
  items: ListingAreaNavItem[]
  title: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-slot="listing-area-selector"
        className="-mx-1 inline-flex min-h-(--np-touch) min-w-0 items-center gap-1 rounded-(--np-radius-tag) px-1 text-left focus-halo hover-fine:underline hover-fine:underline-offset-4 desk:min-h-(--np-control-h)"
      >
        <span className="min-w-0 text-balance break-words">{title}</span>
        <ChevronDownIcon
          aria-hidden
          strokeWidth={1.75}
          className="size-5 shrink-0 text-ink-muted"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" title="Listing areas">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.href}
            render={
              <ShellLink
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
 * The status pill is the tap target for where a change made in this area
 * goes and when the editor last saw Google (LST-06): on a phone, one sheet
 * instead of an info button, a note and a freshness row above the editor.
 * Without a pill a phone gets an info button instead. Wider screens also
 * show the same words as one line under the tabs (`AreaMetaLine`).
 */
function AreaInfo({
  area,
  pill,
  freshness,
  className,
}: {
  area: { key: ListingAreaKey; model: ListingAreaModel }
  pill: React.ReactNode
  freshness: GoogleFreshnessReport | null
  className?: string
}) {
  return (
    <Popover>
      <PopoverTrigger
        data-slot="model-note-trigger"
        render={
          pill ? (
            <button
              type="button"
              className={cn(
                "inline-flex min-h-(--np-touch) shrink-0 items-center gap-1 rounded-(--np-radius-tag) focus-halo",
                className
              )}
            />
          ) : (
            <Button
              variant="ghost"
              size="icon"
              aria-label="How changes reach Google"
              className={className}
            />
          )
        }
      >
        {pill ? (
          <>
            {pill}
            <InfoIcon
              aria-hidden
              strokeWidth={1.75}
              className="size-4 text-ink-muted"
            />
            <span className="sr-only">, how changes reach Google</span>
          </>
        ) : (
          <InfoIcon aria-hidden strokeWidth={1.75} />
        )}
      </PopoverTrigger>
      <PopoverContent align="end" title="How changes reach Google">
        <div className="flex flex-col gap-3 text-body text-ink-secondary">
          <p data-slot="model-note">{modelNote(area.model, area.key)}</p>
          {freshness ? <GoogleFreshnessLine report={freshness} /> : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Wider screens: where a change made here goes and when the editor last
 * saw Google, as ONE line under the tabs instead of two or three rows.
 */
function AreaMetaLine({
  area,
  freshness,
}: {
  area: { key: ListingAreaKey; model: ListingAreaModel }
  freshness: GoogleFreshnessReport | null
}) {
  const ModelIcon = MODEL_ICON[area.model]
  return (
    <div
      data-slot="listing-area-meta"
      className="hidden flex-wrap items-center gap-x-2 gap-y-1 text-ui text-ink-secondary md:flex"
    >
      <ModelIcon
        className="size-4 shrink-0 text-ink-muted"
        strokeWidth={1.75}
        aria-hidden
      />
      <span data-slot="model-note">{modelNote(area.model, area.key)}</span>
      {freshness ? (
        <>
          <span aria-hidden className="text-ink-muted">
            ·
          </span>
          <GoogleFreshnessLine report={freshness} />
        </>
      ) : null}
    </div>
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
 * keeps to two short rows. With Activity the only entry, there is nothing
 * to choose between: the button opens it directly (SET-13).
 */
function HeaderOverflow({
  locationId,
  summary,
  links,
  showReviewPublish,
  onActivity,
  triggerRef,
  className,
}: {
  locationId: string
  summary: ListingSummary | undefined
  links: ListingHeaderLink[]
  showReviewPublish: boolean
  onActivity: () => void
  triggerRef: React.RefObject<HTMLButtonElement | null>
  className?: string
}) {
  const pending =
    showReviewPublish && summary && !googleUnreachable(summary)
      ? unpublishedCount(summary)
      : 0
  if (links.length === 0 && pending === 0) {
    return (
      <Button
        ref={triggerRef}
        variant="ghost"
        size="icon"
        aria-label="Activity"
        data-slot="listing-header-activity"
        className={cn("shrink-0", className)}
        onClick={onActivity}
      >
        <History aria-hidden strokeWidth={1.75} />
      </Button>
    )
  }
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
 * Phone (under 48rem), two short rows so the editor starts high on the
 * screen (LST-06): the listing's name, which switches to its sibling
 * listings, with a "⋯" menu holding the page's links, Review & publish and
 * Activity; then the page title, which opens the area list, with ONE status
 * pill that opens where a change made here goes and when the editor last
 * saw Google. On the overview the title is the listing's name and the
 * switcher (DSK-06), under the client as plain words.
 *
 * Wider screens add the description, the header buttons (Review & publish
 * always among them), the tab row from 64rem, and one line under it for the
 * model note and the editor's last Google check. The client caption is left
 * to the breadcrumb on area pages (DSK-05).
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
  const title = listingPageLabel(current)
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
  const freshness = useGoogleFreshnessReport()
  const [activityOpen, setActivityOpen] = React.useState(false)
  const overflowRef = React.useRef<HTMLButtonElement>(null)

  // The line above the title: on an area, the listing's name (the way back
  // to its overview, and the switcher to its siblings); on the overview,
  // the client as plain words, since the title below is the switcher.
  const context = nested ? (
    <SiblingSwitcher
      current={entry}
      role={role}
      className="text-title font-semibold"
      fallback={
        <Link
          href={listingHref(locationId)}
          data-slot="listing-name"
          className="inline-flex min-h-(--np-control-h) max-w-full min-w-0 items-center gap-0.5 rounded-(--np-radius-tag) text-title font-semibold text-ink underline-offset-3 focus-halo hover:underline"
        >
          {/* "‹ The Bell": the labelled way up to the listing. Below `wide`
              the shell's app bar or toolbar already draws this back control
              from the same trail, so the chevron shows only where the shell
              draws breadcrumbs instead: one labelled back per screen. */}
          <ChevronLeftIcon
            aria-hidden
            strokeWidth={1.75}
            className="-ml-1 hidden size-5 shrink-0 text-ink-muted wide:block"
          />
          <span className="truncate">{entry.name}</span>
        </Link>
      }
    />
  ) : (
    <p className="flex min-h-(--np-control-h) min-w-0 items-center text-ui font-medium text-ink-muted md:min-h-0">
      <span className="truncate">{clientLabel}</span>
    </p>
  )

  const pill =
    status === undefined ? (
      <Skeleton className="h-5 w-28 rounded-(--np-radius-tag)" aria-hidden />
    ) : (
      status
    )

  return (
    <header
      data-slot="listing-area-header"
      className="flex shrink-0 flex-col gap-2 md:gap-3"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 grow basis-80 flex-col md:gap-1">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="flex min-w-0">{context}</div>
            <HeaderOverflow
              locationId={locationId}
              summary={summary}
              links={links}
              showReviewPublish={current !== "changes"}
              onActivity={() => setActivityOpen(true)}
              triggerRef={overflowRef}
              className="md:hidden"
            />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="min-w-0 text-page-title font-semibold text-balance break-words text-ink">
              {nested ? (
                <AreaTitleSwitcher items={items} title={title} />
              ) : (
                <SiblingSwitcher
                  current={entry}
                  role={role}
                  className="text-page-title font-semibold"
                  fallback={entry.name}
                  wrap
                />
              )}
            </h1>
            {area ? (
              <>
                {/* While the summary loads, the info button keeps the note
                    and "Check Google now" reachable on a phone. */}
                {status === undefined ? pill : null}
                <AreaInfo
                  area={area}
                  pill={status ?? null}
                  freshness={freshness}
                  className={status ? undefined : "md:hidden"}
                />
              </>
            ) : (
              pill
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
            // Always a header action: the tab row no longer carries it, so
            // it is never cut off at the strip's end (DSK-01).
            <ReviewPublishLink locationId={locationId} summary={summary} />
          )}
          <ActivityDrawer
            locationId={locationId}
            open={activityOpen}
            onOpenChange={setActivityOpen}
            returnFocus={overflowRef}
          />
        </div>
      </div>

      <ListingAreaTabs items={items} />

      {area ? <AreaMetaLine area={area} freshness={freshness} /> : null}
      <GoogleFreshnessFailure report={freshness} className="text-ui" />
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
  const now = useNow()
  const state = areaState(area, summary, now)
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
    <InAreaFrameContext.Provider value>
      <EditorStatusProvider>
        <GoogleFreshnessSlot>
          <AreaFrameBody {...props} />
        </GoogleFreshnessSlot>
      </EditorStatusProvider>
    </InAreaFrameContext.Provider>
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
  // The pane scrolls from md and 620px tall (the classes below).
  const paneScrolls = useMediaQuery(PANE_SCROLLS_QUERY)
  // An editor's "In sync" is a claim about Google; while Google can't be
  // reached for this listing the summary's "Unknown" speaks instead.
  const reported = editorStatusPill(editor)
  const editorPill =
    reported &&
    (reported.tone === "healthy" || editor?.emptyOnGoogle === reported.label) &&
    googleUnreachable(summary.data)
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

  // The frame lives in the listing's layout, so the pane outlives an area
  // switch: start the new area at its top, as a fresh page would.
  const paneRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    paneRef.current?.scrollTo?.({ top: 0 })
  }, [areaKey])

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
          {/* A keyboard user must be able to scroll it even when the editor
              holds nothing focusable (a viewer's read-only hours or booking),
              so where it scrolls it is a named, focusable region (WCAG 2.1.1,
              axe scrollable-region-focusable). Where it does not scroll (a
              phone) it is no Tab stop. The halo is drawn inside the box:
              PageFrame clips anything outside the full-bleed pane. */}
          <div
            ref={paneRef}
            role="region"
            aria-label={listingArea(areaKey).label}
            tabIndex={paneScrolls ? 0 : undefined}
            className={cn(
              "flex flex-col gap-6 rounded-(--np-radius-card) outline-none focus-visible:ring-2 focus-visible:ring-(--np-focus-ring) focus-visible:ring-inset md:[@media(min-height:620px)]:min-h-0 md:[@media(min-height:620px)]:flex-1 md:[@media(min-height:620px)]:overflow-y-auto",
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

/**
 * The listing layout's frame (`app/(dashboard)/listings/[id]/layout.tsx`):
 * an area route renders inside one `AreaFrame` that survives switching to
 * another area, so the header never remounts; the overview and Review &
 * publish render their own header and pass through.
 */
function ListingAreaLayout({
  locationId,
  role,
  children,
}: {
  locationId: string
  role: string | null
  children: React.ReactNode
}) {
  const segment = useSelectedLayoutSegment()
  const area = segment ? areaForSegment(segment) : undefined
  if (!area) return children
  return (
    <AreaFrame locationId={locationId} role={role} area={area.key}>
      {children}
    </AreaFrame>
  )
}

export {
  AreaFrame,
  AreaStatusPill,
  ListingAreaHeader,
  ListingAreaLayout,
  ReviewPublishLink,
}
