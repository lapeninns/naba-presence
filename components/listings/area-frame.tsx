"use client"

import {
  DownloadIcon,
  GlobeIcon,
  SendIcon,
  ShieldCheckIcon,
  UploadIcon,
} from "lucide-react"
import Link from "next/link"
import * as React from "react"

import { PageFrame, EYEBROW_CLASS } from "@/components/app-shell/page-frame"
import { useQueryClient } from "@tanstack/react-query"

import { ActivityDrawer } from "@/components/editors/activity-drawer"
import {
  EditorStatusProvider,
  editorStatusPill,
  useEditorStatus,
} from "@/components/editors/editor-status"
import { ListingGate } from "@/components/listings/listing-gate"
import { SiblingSwitcher } from "@/components/listings/sibling-switcher"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import { TabNav, type TabNavItem } from "@/components/ui/tabs"
import type { ListingSummary } from "@/lib/contracts/location-summary"
import { formatNumber } from "@/lib/format"
import { areaState, suggestionCount } from "@/lib/listings/area-state"
import { googleUnreachable, unpublishedCount } from "@/lib/listings/health"
import {
  listingArea,
  listingHref,
  modelNote,
  visibleListingAreas,
  type ListingAreaKey,
  type ListingAreaModel,
} from "@/lib/listings/areas"
import {
  resourceDisabledReason,
  type LocationCapabilities,
} from "@/lib/locations/gating"
import type { DirectoryEntry } from "@/lib/queries/use-locations"
import { queryKeys } from "@/lib/queries/keys"
import { useListingSummary } from "@/lib/queries/use-listing-summary"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { cn } from "@/lib/utils"

/**
 * The gutters and bottom padding of PageFrame, negated and then restored as
 * padding on the scrolling pane: an editor's sticky footer bleeds to the
 * pane's edges (its own negative margins mirror these), and `overflow-y-auto`
 * would otherwise clip that bleed.
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
  inbound: DownloadIcon,
}

/** Where a listing page sits: its overview, one area, or Review & publish. */
export type ListingPageKey = ListingAreaKey | "overview" | "changes"

/**
 * Why an area can't be used on this listing, from the same capability
 * evaluation its overview card uses: "unavailable" or "blocked", not a
 * read-only role (that area still opens, to look).
 */
function areaUnavailableReason(
  caps: LocationCapabilities | undefined,
  linked: boolean,
  capability: string | undefined
): string | null {
  if (!linked) return "Not linked to Google"
  if (!caps || !capability) return null
  const state = caps.resources?.[capability]?.state
  if (state !== "unavailable" && state !== "blocked") return null
  return resourceDisabledReason(caps, capability, true)
}

/**
 * The area tabs: Overview plus every area this role may open, each a link.
 * The suggestions tab carries its real pending count from the DB-only
 * summary; an area this listing can't use is drawn muted with the reason.
 * The row scrolls sideways on a narrow screen (its edges fade while there
 * is more to see), and the current tab is scrolled into view on arrival so
 * the selected state is never off-screen.
 */
function ListingAreaTabs({
  locationId,
  current,
  canManageConsoles,
  summary,
  caps,
  linked,
}: {
  locationId: string
  current: ListingPageKey
  canManageConsoles: boolean
  summary: ListingSummary | undefined
  caps?: LocationCapabilities
  linked: boolean
}) {
  const navRef = React.useRef<HTMLElement>(null)
  const pending = suggestionCount(summary)

  React.useEffect(() => {
    const nav = navRef.current
    const row = nav?.querySelector("ul")
    const link = nav?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!row || !link) return
    const visible =
      link.offsetLeft >= row.scrollLeft &&
      link.offsetLeft + link.offsetWidth <= row.scrollLeft + row.clientWidth
    if (visible) return
    // Centre the current tab inside its own row. Not scrollIntoView: that
    // would also scroll the page vertically.
    const left = link.offsetLeft - (row.clientWidth - link.offsetWidth) / 2
    row.scrollLeft = Math.max(0, left)
  }, [current])

  const items: TabNavItem[] = [
    {
      href: listingHref(locationId),
      label: "Overview",
      current: current === "overview",
    },
    ...visibleListingAreas(canManageConsoles).map((area) => ({
      href: listingHref(locationId, area.segment),
      label: area.label,
      current: area.key === current,
      unavailableReason: areaUnavailableReason(caps, linked, area.capability),
      badge:
        area.key === "suggestions" && pending > 0 ? (
          <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-(--np-radius-tag) bg-warning-tint px-1.5 font-mono text-[11px] font-semibold text-warning-ink tabular-nums">
            <span aria-hidden>{formatNumber(pending)}</span>
            <span className="sr-only">, {formatNumber(pending)} waiting</span>
          </span>
        ) : undefined,
    })),
  ]

  return (
    <TabNav
      ref={navRef}
      aria-label="Listing areas"
      items={items}
      data-slot="listing-area-tabs"
    />
  )
}

/**
 * "Review & publish (n)", for every page of a listing while edits saved
 * here are waiting, so the way to publish them is never only on the
 * overview. Hidden while the Google login is broken (nothing can go out).
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
      className={cn(buttonVariants({ className: "max-sm:col-span-2" }), className)}
    >
      <UploadIcon aria-hidden strokeWidth={1.75} />
      Review & publish ({formatNumber(pending)})
    </Link>
  )
}

/**
 * The shared head of every listing page (reference `.area-head`): the client
 * as an eyebrow, the listing's own name (on an area, above the area's title,
 * so which venue this is never has to be inferred), the page title in the
 * serif with its status pill, the sibling switcher and the page's actions,
 * the area tabs, and — on an area — the one line saying where a change made
 * here goes.
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
}: {
  entry: DirectoryEntry
  role: string | null
  locationId: string
  current: ListingPageKey
  summary: ListingSummary | undefined
  caps?: LocationCapabilities
  status: React.ReactNode | undefined
  description?: React.ReactNode
  actions?: React.ReactNode
}) {
  const canManageConsoles = role === "owner" || role === "admin"
  const area =
    current === "overview" || current === "changes"
      ? null
      : listingArea(current)
  const ModelIcon = area ? MODEL_ICON[area.model] : null
  const title =
    current === "changes" ? "Review & publish" : area ? area.label : entry.name
  const nested = current !== "overview"

  return (
    <header
      data-slot="listing-area-header"
      className="flex shrink-0 flex-col gap-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-1.5">
          <p className={EYEBROW_CLASS}>
            {entry.clientName ?? "Not filed under a client"}
          </p>
          {nested ? (
            <Link
              href={listingHref(locationId)}
              data-slot="listing-name"
              className="w-fit rounded-(--np-radius-tag) text-title font-semibold break-words text-ink underline-offset-3 focus-halo hover:underline"
            >
              {entry.name}
            </Link>
          ) : null}
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <h1 className="min-w-0 font-display text-page-title font-semibold text-balance break-words text-ink">
              {title}
            </h1>
            {status === undefined ? (
              <Skeleton
                className="h-[22px] w-28 rounded-(--np-radius-tag)"
                aria-hidden
              />
            ) : (
              status
            )}
          </div>
          {area ? (
            <p className="text-ui text-pretty text-ink-muted">
              {area.description}
            </p>
          ) : description ? (
            <p className="max-w-[70ch] text-ui text-pretty text-ink-muted">
              {description}
            </p>
          ) : null}
        </div>
        {/* Phones: the switcher takes its own row and the buttons share the
            next ones two to a row; from 640px they sit in one wrapping row. */}
        <div className="grid w-full grid-cols-2 items-center gap-2 *:min-w-0 sm:ml-auto sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
          <SiblingSwitcher
            current={entry}
            role={role}
            className="col-span-2 w-full sm:w-56"
          />
          {actions}
        </div>
      </div>

      <ListingAreaTabs
        locationId={locationId}
        current={current}
        canManageConsoles={canManageConsoles}
        summary={summary}
        caps={caps}
        linked={entry.linked}
      />

      {area && ModelIcon ? (
        <p
          data-slot="model-note"
          className="-mt-1 flex items-start gap-2 text-ui text-ink-secondary"
        >
          <ModelIcon
            className="mt-0.5 size-4 shrink-0 text-ink-muted"
            strokeWidth={1.75}
            aria-hidden
          />
          <span>{modelNote(area.model)}</span>
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
 * the story), carries the area tabs, and says in one line where a change
 * made here goes. The editor below scrolls in its own pane so an editor's
 * pinned footer stays on screen.
 *
 * Props are stable for the editors that render inside it: `locationId`,
 * `role`, `area`, `children`. `actions` (extra header buttons, before
 * Activity) and `status` (replaces the summary pill; `null` hides it) are
 * optional.
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
    ) : editorPill ? (
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
            actions={
              <>
                {actions}
                <ReviewPublishLink
                  locationId={locationId}
                  summary={summary.data}
                />
                <ActivityDrawer locationId={locationId} />
              </>
            }
          />

          {/* The scrolling pane: where PageFrame width="workspace" locks
              <main> to the viewport (768 wide and 620 tall), the editor
              scrolls here and its footer pins to the pane's bottom edge.
              Below that the pane is not a scroller: the page scrolls with
              the column, as PageFrame intends. Scrolling here too left a
              phone (or a phone with its keyboard up) a pane of about 100px
              under a 420px header, all of it covered by the footer bar. */}
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

export {
  AreaFrame,
  AreaStatusPill,
  ListingAreaHeader,
  modelNote,
  ReviewPublishLink,
}
