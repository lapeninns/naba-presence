"use client"

import {
  CheckIcon,
  CircleAlertIcon,
  EyeIcon,
  PencilIcon,
  RefreshCwIcon,
  UnplugIcon,
  UploadIcon,
} from "lucide-react"
import Link from "next/link"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react"

import { PageFrame } from "@/components/app-shell/page-frame"
import type { ChangeRow } from "@/components/editors/change-diff"
import { ActivityDrawer } from "@/components/editors/activity-drawer"
import { ListingAreaHeader } from "@/components/listings/area-frame"
import { ListingGate } from "@/components/listings/listing-gate"
import { ActionBar, ActionBarMuted } from "@/components/ui/action-bar"
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DiffView } from "@/components/ui/diff-view"
import { Empty } from "@/components/ui/empty"
import {
  PublishSteps,
  type PublishStep as PublishStepRow,
} from "@/components/ui/publish-steps"
import { SectionHeader } from "@/components/ui/section-header"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { StatusPill } from "@/components/ui/status-pill"
import { fetchHours, publishHours } from "@/lib/api/location-hours"
import { fetchFoodMenus, publishFoodMenus } from "@/lib/api/location-menu"
import {
  fetchProfile,
  runProfileOperation,
  type ProfileFieldKey,
} from "@/lib/api/location-profile"
import type { ListingSummary } from "@/lib/contracts/location-summary"
import {
  NOTHING_TO_SEND,
  usePublishFlow,
  type PublishStep,
  type PublishStepResult,
} from "@/lib/editors/use-publish-flow"
import { describeActionError } from "@/lib/errors/action-errors"
import { formatNumber } from "@/lib/format"
import { listingHref } from "@/lib/listings/areas"
import { hoursChangeRows } from "@/lib/locations/hours-diff"
import { menuChangeRows } from "@/lib/locations/menu-diff"
import { queryKeys } from "@/lib/queries/keys"
import { useListingSummary } from "@/lib/queries/use-listing-summary"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { useHours } from "@/lib/queries/use-location-hours"
import { useFoodMenus } from "@/lib/queries/use-location-menu"
import { useProfile } from "@/lib/queries/use-location-profile"
import { cn } from "@/lib/utils"

const PROFILE_LABELS: Record<ProfileFieldKey, string> = {
  name: "Business name",
  description: "Description",
  phone: "Phone",
  address: "Address",
  mapsUrl: "Google Maps link",
  reviewUrl: "Review link",
  website: "Website",
}

/** The fields NabaPresence holds a copy of and can push to Google. */
const PUBLISHABLE: ProfileFieldKey[] = [
  "name",
  "description",
  "phone",
  "website",
]

type AreaKey = "profile" | "hours" | "menu"

/** Which canonical areas the summary says have local edits to publish. */
function pendingAreas(summary: ListingSummary): AreaKey[] {
  const dirty = (status: string) =>
    status === "core_dirty" || status === "conflict"
  const areas: AreaKey[] = []
  if (dirty(summary.profile.status)) areas.push("profile")
  if (dirty(summary.hours.status)) areas.push("hours")
  if (dirty(summary.menu.status) && summary.menu.eligible !== false)
    areas.push("menu")
  return areas
}

type AreaReview = {
  key: AreaKey
  label: string
  rows: ChangeRow[]
  needsAck: boolean
  steps: PublishStep[]
}

/**
 * Loads one canonical area live (this is the one place Google is read at
 * review time) and reports its diff rows plus the publish steps that would
 * send them. Each area keeps the exact hash-pinned call its own editor
 * makes; nothing here invents a new write.
 */
function useProfileReview(locationId: string, enabled: boolean) {
  const query = useProfile(locationId)
  const review = useMemo<AreaReview | null>(() => {
    if (!enabled || !query.data) return null
    const profile = query.data
    const fields = profile.fields.filter(
      (field) => PUBLISHABLE.includes(field.key) && field.status !== "in_sync"
    )
    const rows: ChangeRow[] = fields.map((field) => ({
      key: field.key,
      field: PROFILE_LABELS[field.key],
      before: field.googleValue ?? "",
      after: field.canonicalValue ?? "",
      state:
        field.status === "conflict" || field.status === "google_dirty"
          ? "conflict"
          : "changed",
    }))
    const needsAck = fields.some(
      (field) => field.status === "conflict" || field.status === "google_dirty"
    )
    return {
      key: "profile",
      label: "Business profile",
      rows,
      needsAck,
      steps: rows.length
        ? [
            {
              key: "profile",
              label: `Business profile · ${rows
                .map((row) => row.field.toLowerCase())
                .join(", ")}`,
              run: async () => {
                const fresh = await fetchProfile(locationId)
                const selected = fresh.fields
                  .filter(
                    (f) => PUBLISHABLE.includes(f.key) && f.status !== "in_sync"
                  )
                  .map((f) => f.key)
                if (selected.length === 0) return NOTHING_TO_SEND
                await runProfileOperation(locationId, {
                  direction: "to_google",
                  confirmation: "publish_nabapresence_profile_to_google",
                  selectedFields: selected,
                  expectedCanonicalRevision: fresh.canonicalResource.revision,
                  expectedCanonicalHash: fresh.canonicalHash,
                  expectedGoogleHash: fresh.googleHash,
                  confirmOverwriteGoogleChanges: needsAck,
                })
              },
            },
          ]
        : [],
    }
  }, [enabled, query.data, locationId])
  return { query, review }
}

function useHoursReview(locationId: string, enabled: boolean) {
  const query = useHours(locationId)
  const review = useMemo<AreaReview | null>(() => {
    if (!enabled || !query.data) return null
    const hours = query.data
    const needsAck =
      hours.status === "google_dirty" || hours.status === "conflict"
    // The row-level conflict flag compares Google with a baseline this state
    // does not carry (draft and canonical are the same saved copy here), so
    // it would mark every row. The area's own drift status decides instead.
    const rows = hoursChangeRows({
      draft: hours.canonical,
      google: hours.google,
      canonical: hours.canonical,
    }).map((row) => ({
      ...row,
      state: needsAck ? ("conflict" as const) : ("changed" as const),
    }))
    return {
      key: "hours",
      label: "Opening hours",
      rows,
      needsAck,
      steps:
        hours.updateMask.length > 0
          ? [
              {
                key: "hours",
                label: "Opening hours",
                run: async () => {
                  const fresh = await fetchHours(locationId)
                  if (fresh.updateMask.length === 0) return NOTHING_TO_SEND
                  await publishHours(locationId, {
                    expectedCanonicalRevision: fresh.canonicalResource.revision,
                    expectedCanonicalHash: fresh.canonicalHash,
                    expectedGoogleHash: fresh.googleHash,
                    approvedUpdateMask: fresh.updateMask,
                    confirmOverwriteGoogleChanges: needsAck,
                  })
                },
              },
            ]
          : [],
    }
  }, [enabled, query.data, locationId])
  return { query, review }
}

function useMenuReview(locationId: string, enabled: boolean) {
  const query = useFoodMenus(locationId)
  const review = useMemo<AreaReview | null>(() => {
    if (!enabled || !query.data) return null
    const state = query.data
    const rows = menuChangeRows({
      draft: state.canonicalMenus as Array<Record<string, unknown>>,
      google: state.googleMenus as Array<Record<string, unknown>>,
    })
    return {
      key: "menu",
      label: "Food menu",
      rows,
      needsAck: false,
      steps:
        state.status === "in_sync"
          ? []
          : [
              {
                key: "menu",
                label: "Food menu · replaces the menu on Google",
                run: async () => {
                  const fresh = await fetchFoodMenus(locationId)
                  if (fresh.status === "in_sync") return NOTHING_TO_SEND
                  await publishFoodMenus(locationId, {
                    expectedCanonicalRevision: fresh.canonicalResource.revision,
                    expectedCanonicalHash: fresh.canonicalHash,
                    expectedGoogleHash: fresh.googleHash,
                  })
                },
              },
            ],
    }
  }, [enabled, query.data, locationId])
  return { query, review }
}

/** "Monday, Tuesday and 2 more": names the fields without a paragraph. */
function listFields(fields: string[]): string {
  if (fields.length === 0) return "some of these"
  if (fields.length <= 3)
    return fields.length === 1
      ? fields[0]!
      : `${fields.slice(0, -1).join(", ")} and ${fields.at(-1)}`
  return `${fields.slice(0, 2).join(", ")} and ${fields.length - 2} more`
}

const AREA_LABEL: Record<AreaKey, string> = {
  profile: "Business profile",
  hours: "Opening hours",
  menu: "Food menu",
}

/**
 * One area's pre-publication diff: what Google shows now against what it
 * will show after publishing, field by field. Below 560px of its own width
 * the columns stack and every value carries its label.
 */
function AreaSection({
  locationId,
  area,
  review,
  pending,
  error,
  onRetry,
  include,
}: {
  locationId: string
  area: AreaKey
  review: AreaReview | null
  pending: boolean
  error: unknown
  onRetry: () => void
  /**
   * Whether this area goes out with the others. Omitted when there is only
   * one area to publish (nothing to choose between).
   */
  include?: {
    checked: boolean
    onChange: (checked: boolean) => void
    disabled: boolean
  }
}) {
  const label = AREA_LABEL[area]
  const headingId = `review-${area}`
  const conflict = review?.needsAck ?? false
  return (
    <section
      aria-labelledby={headingId}
      data-slot="review-area"
      data-area={area}
      className="flex flex-col overflow-hidden rounded-(--np-radius-card) border border-line bg-surface"
    >
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <h2 id={headingId} className="text-title font-semibold text-ink">
            {label}
          </h2>
          {review ? (
            review.rows.length === 0 ? (
              <StatusPill tone="healthy">In sync with Google</StatusPill>
            ) : conflict ? (
              <StatusPill tone="attention">Google changed too</StatusPill>
            ) : (
              <StatusPill tone="pending">Not on Google yet</StatusPill>
            )
          ) : null}
          {review && review.rows.length > 0 ? (
            <span className="font-mono text-caption text-ink-muted tabular-nums">
              {review.rows.length === 1
                ? "1 field"
                : `${formatNumber(review.rows.length)} fields`}
            </span>
          ) : null}
        </div>
        <Link
          href={listingHref(locationId, area)}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          aria-label={`Edit ${label.toLowerCase()}`}
        >
          <PencilIcon aria-hidden />
          Edit
        </Link>
      </div>
      {include && review && review.rows.length > 0 ? (
        <div className="border-b border-line bg-surface-alt px-4 py-2.5">
          <Checkbox
            checked={include.checked}
            disabled={include.disabled}
            onCheckedChange={(checked) => include.onChange(Boolean(checked))}
            label={`Include ${label.toLowerCase()} in this publish`}
            description={
              include.checked
                ? undefined
                : "Left out: it stays saved here and waits for the next publish."
            }
          />
        </div>
      ) : null}
      <div className="flex flex-col gap-3 p-4">
        {error ? (
          <div role="alert" className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-[1_1_16rem] text-ui text-ink">
              <CircleAlertIcon
                className="mr-1.5 inline size-4 align-[-3px] text-danger-ink"
                aria-hidden
              />
              We couldn’t read {label.toLowerCase()} from Google, so its changes
              can’t be shown or published.{" "}
              <span className="text-ink-muted">
                {describeActionError(error)}
              </span>
            </p>
            <Button variant="secondary" size="sm" onClick={onRetry}>
              <RefreshCwIcon aria-hidden />
              Try again
            </Button>
          </div>
        ) : pending || !review ? (
          <p
            aria-busy="true"
            className="flex items-center gap-2.5 py-1 text-ui text-ink-muted"
          >
            <Spinner decorative />
            Reading {label.toLowerCase()} from Google…
          </p>
        ) : review.rows.length === 0 ? (
          <p className="text-ui text-ink-muted">
            Nothing left to publish here: the saved copy already matches Google.
          </p>
        ) : (
          <>
            <DiffView
              rows={review.rows.map((row) => ({
                field: row.field,
                before: row.before,
                after: row.after,
                state: row.state === "conflict" ? "conflict" : "changed",
              }))}
              caption={`Changes to publish for ${label}`}
            />
            <p className="text-caption text-ink-muted">
              “On Google now” was read from Google when this page opened.
            </p>
          </>
        )}
      </div>
    </section>
  )
}

/**
 * The per-area step list from the publish flow's real results. A step that
 * is running has left the app and not answered yet; a finished step is one
 * Google accepted and read back; the first failure stops the rest, which are
 * shown as not sent.
 */
function toStepRows(
  results: PublishStepResult[],
  onRetry: (() => void) | null,
  retryRef?: Ref<HTMLButtonElement>
): PublishStepRow[] {
  const failedAt = results.findIndex((step) => step.status === "failed")
  return results.map((step, index) => {
    if (step.status === "running")
      return {
        id: step.key,
        label: step.label,
        state: "sent",
        stateLabel: "Sent to Google — waiting for the answer",
        detail: "Keep this page open until Google answers.",
      }
    if (step.status === "done" && step.noop)
      return {
        id: step.key,
        label: step.label,
        state: "skipped",
        stateLabel: "Nothing to send",
        detail:
          "It already matched Google when this step ran, so nothing was sent.",
      }
    if (step.status === "done")
      return {
        id: step.key,
        label: step.label,
        // Done means the server's publish read Google back and it matched.
        state: "live",
        stateLabel: "Accepted by Google",
        detail:
          "Google accepted it and read it back as sent. It can take a few minutes to show on Maps and Search.",
      }
    if (step.status === "failed")
      return {
        id: step.key,
        label: step.label,
        state: "failed",
        errorCode: step.code,
        detail: `${step.message ?? "Google didn’t accept this change."} Nothing from this step is on Google; the saved copy is kept.`,
        action: onRetry ? (
          <Button
            ref={retryRef}
            variant="secondary"
            size="sm"
            onClick={onRetry}
          >
            <RefreshCwIcon aria-hidden />
            Retry
          </Button>
        ) : undefined,
      }
    if (failedAt !== -1 && index > failedAt)
      return {
        id: step.key,
        label: step.label,
        state: "skipped",
        stateLabel: "Not sent",
        detail: "Stopped after the failure above. Still saved here.",
      }
    return { id: step.key, label: step.label, state: "pending" }
  })
}

function ReviewSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      {[0, 1].map((index) => (
        <div
          key={index}
          className="flex flex-col gap-3 rounded-(--np-radius-card) border border-line bg-surface p-4"
        >
          <Skeleton className="h-[18px] w-1/3" />
          <Skeleton className="h-3.5 w-3/5" />
          <Skeleton className="h-20 w-full" />
        </div>
      ))}
      <Skeleton className="h-14 w-full rounded-(--np-radius-card)" />
    </div>
  )
}

/**
 * Everything waiting to go to Google, from every canonical area, on one
 * page. The summary says which areas have local edits; each of those is
 * read live here — the one moment Google is read at review time — and its
 * exact hash-pinned publish call is queued. Steps run in order, the first
 * failure stops the rest, and every step reports its own result.
 */
function ReviewPublish({
  locationId,
  role,
}: {
  locationId: string
  role: string | null
}) {
  const summary = useListingSummary(locationId)
  const caps = useLocationCapabilities(locationId)
  const areas = summary.data ? pendingAreas(summary.data) : []
  const profile = useProfileReview(locationId, areas.includes("profile"))
  const hours = useHoursReview(locationId, areas.includes("hours"))
  const menu = useMenuReview(locationId, areas.includes("menu"))
  const [acknowledged, setAcknowledged] = useState(false)
  // Areas the operator left out of this publish. Each area publishes through
  // its own call, so leaving one out simply doesn't queue its step.
  const [excluded, setExcluded] = useState<AreaKey[]>([])

  const allReviews = [profile.review, hours.review, menu.review].filter(
    (review): review is AreaReview => review !== null
  )
  const reviews = allReviews.filter(
    (review) => !excluded.includes(review.key)
  )
  const includedAreas = areas.filter((area) => !excluded.includes(area))
  const rows = reviews.reduce((sum, review) => sum + review.rows.length, 0)
  const needsAck = reviews.some((review) => review.needsAck)
  const ackFields = reviews.flatMap((review) =>
    review.rows
      .filter((row) => row.state === "conflict")
      .map((row) => row.field)
  )
  const steps = reviews.flatMap((review) => review.steps)
  const loading =
    (areas.includes("profile") && profile.query.isPending) ||
    (areas.includes("hours") && hours.query.isPending) ||
    (areas.includes("menu") && menu.query.isPending)
  // An area that couldn't be read has no diff and no step, so publishing now
  // would quietly leave it out while the button still counted it.
  const unreadable = areas.filter((area) => {
    const query =
      area === "profile"
        ? profile.query
        : area === "hours"
          ? hours.query
          : menu.query
    return query.isError && !query.data
  })

  const buildSteps = useCallback(() => steps, [steps])
  const flow = usePublishFlow({
    steps: buildSteps,
    invalidate: [
      queryKeys.listingSummary(locationId),
      queryKeys.listingSummaries,
      queryKeys.locationProfile(locationId),
      queryKeys.locationBusinessInformation(locationId),
      queryKeys.locationHours(locationId),
      queryKeys.locationMenu(locationId),
      queryKeys.locationActivity(locationId),
    ],
    successToast: "Published to Google",
  })
  const done =
    flow.results.length > 0 &&
    flow.results.every((step) => step.status === "done")

  const connection = summary.data?.connection
  // Not the deployment-wide publishing switch (the editors' "paused" banner):
  // this listing's own Google login is broken. An owner or admin fixes it
  // by reconnecting from Setup.
  const paused = Boolean(
    connection &&
    (connection.status !== "active" || connection.reconnectRequired)
  )
  const canManage = role === "owner" || role === "admin"
  const cannotPublish = caps.data ? !caps.data.canPublish : false

  const disabledReason = paused
    ? canManage
      ? "Publishing is paused until the client’s Google login is reconnected."
      : "Publishing is paused until an owner or admin reconnects the client’s Google login."
    : cannotPublish
      ? "You can review these changes, but publishing is limited to people with publish access."
      : loading
        ? "Wait until every area has been read from Google."
        : unreadable.length > 0
          ? `Couldn’t read ${AREA_LABEL[unreadable[0]!].toLowerCase()} from Google. Try again above first.`
          : includedAreas.length === 0
            ? "Include at least one area to publish."
            : steps.length === 0
            ? "Nothing is left to publish."
            : needsAck && !acknowledged
              ? "Confirm the Google change first."
              : undefined

  const publish = () => void flow.publish()
  const retry = flow.error && !flow.isPublishing ? publish : null
  const nothingSent = done && flow.results.every((step) => step.noop === true)

  // A failure moves focus to its Retry, so a keyboard or screen-reader user
  // lands on the step that stopped rather than on a now-idle button.
  const retryRef = useRef<HTMLButtonElement>(null)
  const failed = Boolean(flow.error) && !flow.isPublishing
  useEffect(() => {
    if (failed) retryRef.current?.focus()
  }, [failed])

  return (
    <ListingGate locationId={locationId} role={role}>
      {(entry) => (
        <PageFrame width="standard">
          {/* The same header every listing page has: client, listing name
              (the way back to the overview), the tabs. */}
          <ListingAreaHeader
            entry={entry}
            role={role}
            locationId={locationId}
            current="changes"
            summary={summary.data}
            caps={caps.data}
            status={null}
            description={
              done
                ? "Every change was sent. Google’s answers are below."
                : summary.isPending
                  ? "Checking what is waiting…"
                  : summary.isError
                    ? "We couldn’t check what is waiting."
                    : areas.length === 0
                      ? "Nothing is waiting to go to Google."
                      : `${areas.length === 1 ? "1 area has" : `${areas.length} areas have`} changes saved here that are not yet on Google. Each area is read from Google so you can compare before publishing.`
            }
            actions={<ActivityDrawer locationId={locationId} />}
          />

          {summary.isError && !summary.data ? (
            <div className="rounded-(--np-radius-card) border border-line bg-surface">
              <Empty
                tone="bad"
                icon={<CircleAlertIcon />}
                titleAs="h2"
                title="We couldn’t check this listing"
                description={`The listing summary didn’t load, so we can’t say which areas have changes. Nothing was sent to Google. ${describeActionError(summary.error)}`}
                action={
                  <Button
                    variant="secondary"
                    onClick={() => void summary.refetch()}
                  >
                    <RefreshCwIcon aria-hidden />
                    Try again
                  </Button>
                }
              />
            </div>
          ) : summary.isPending ? (
            <ReviewSkeleton />
          ) : areas.length === 0 || done ? (
            <div className="flex flex-col gap-4">
              {done ? (
                <PublishSteps
                  aria-label="Publish results"
                  steps={toStepRows(flow.results, null)}
                />
              ) : null}
              <div className="rounded-(--np-radius-card) border border-line bg-surface">
                <Empty
                  tone="ok"
                  icon={<CheckIcon />}
                  titleAs="h2"
                  title={
                    nothingSent
                      ? "Nothing needed sending"
                      : done
                        ? "Published to Google"
                        : "Nothing to publish"
                  }
                  description={
                    nothingSent
                      ? "Every area already matched Google when it was checked, so nothing was sent."
                      : done
                        ? "Google accepted every change and read it back as sent. The overview and the board now show the new state."
                        : `There are no saved changes waiting for ${entry.name}. Edit an area and come back here to publish it.`
                  }
                  action={
                    <Link
                      href={listingHref(locationId)}
                      className={cn(
                        buttonVariants({
                          variant: done ? "default" : "secondary",
                        })
                      )}
                    >
                      Back to listing
                    </Link>
                  }
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {paused ? (
                <Alert variant="destructive" icon={<UnplugIcon aria-hidden />}>
                  <AlertTitle>Publishing is paused for {entry.name}</AlertTitle>
                  <AlertDescription>
                    The client’s Google login needs reconnecting, so Google
                    can’t be read or written. Your saved changes are kept.{" "}
                    {canManage
                      ? "Reconnect it from Setup, then come back here."
                      : "Ask an owner or admin to reconnect it."}
                  </AlertDescription>
                  {canManage && entry.clientId ? (
                    <AlertActions>
                      <Link
                        href={`/setup?client=${entry.clientId}&step=connect`}
                        className={cn(
                          buttonVariants({ variant: "secondary", size: "sm" })
                        )}
                      >
                        Reconnect Google
                      </Link>
                    </AlertActions>
                  ) : null}
                </Alert>
              ) : null}
              {cannotPublish && !paused ? (
                <Alert variant="info" icon={<EyeIcon aria-hidden />}>
                  <AlertTitle>
                    You can review these changes but not publish them
                  </AlertTitle>
                  <AlertDescription>
                    Publishing to Google is limited to owners, admins and
                    members with publish access to this listing.
                  </AlertDescription>
                </Alert>
              ) : null}

              {areas.map((area) => {
                const source =
                  area === "profile" ? profile : area === "hours" ? hours : menu
                return (
                  <AreaSection
                    key={area}
                    locationId={locationId}
                    area={area}
                    review={source.review}
                    pending={source.query.isPending}
                    error={source.query.error}
                    onRetry={() => void source.query.refetch()}
                    include={
                      areas.length > 1
                        ? {
                            checked: !excluded.includes(area),
                            disabled: flow.isPublishing,
                            onChange: (checked) =>
                              setExcluded((current) =>
                                checked
                                  ? current.filter((key) => key !== area)
                                  : [...current, area]
                              ),
                          }
                        : undefined
                    }
                  />
                )
              })}

              {needsAck ? (
                <Alert variant="warning">
                  <AlertTitle>
                    Google changed {listFields(ackFields)} after{" "}
                    {ackFields.length === 1 ? "it was" : "they were"} edited
                    here
                  </AlertTitle>
                  <AlertDescription>
                    Publishing replaces Google’s{" "}
                    {ackFields.length === 1 ? "value" : "values"} with yours.
                    Compare them above first.
                  </AlertDescription>
                  <AlertActions>
                    <Checkbox
                      checked={acknowledged}
                      disabled={flow.isPublishing}
                      onCheckedChange={(checked) =>
                        setAcknowledged(Boolean(checked))
                      }
                      label="I’ve read what Google has now and want to replace it."
                    />
                  </AlertActions>
                </Alert>
              ) : null}

              {flow.results.length > 0 ? (
                <section
                  aria-labelledby="publish-progress"
                  className="flex flex-col gap-3"
                >
                  <SectionHeader
                    as="h2"
                    id="publish-progress"
                    title="Publishing"
                    description="Steps run in order. The first failure stops the rest."
                  />
                  <PublishSteps
                    aria-label="Publish results"
                    steps={toStepRows(flow.results, retry, retryRef)}
                  />
                </section>
              ) : null}

              {flow.error && !flow.isPublishing ? (
                <Alert variant="destructive">
                  <AlertTitle>
                    {`Publishing stopped at “${
                      flow.results.find((step) => step.status === "failed")
                        ?.label ?? "a step"
                    }”`}
                  </AlertTitle>
                  <AlertDescription>
                    Nothing from that step is on Google. The steps after it were
                    not sent, and your saved copy is kept. Retry when you are
                    ready, or edit the area first.
                  </AlertDescription>
                </Alert>
              ) : null}

              <ActionBar
                offset="bottom-3"
                label="Publish to Google"
                status={
                  <>
                    {flow.isPublishing ? (
                      <Spinner decorative />
                    ) : (
                      <UploadIcon aria-hidden />
                    )}
                    <span className="min-w-0">
                      {flow.isPublishing ? (
                        "Publishing — keep this page open"
                      ) : loading ? (
                        "Reading each area from Google…"
                      ) : (
                        <>
                          <span className="font-mono tabular-nums">
                            {formatNumber(rows)}
                          </span>{" "}
                          {rows === 1 ? "field" : "fields"} will change on
                          Google
                          {disabledReason && steps.length > 0 ? (
                            <ActionBarMuted> · {disabledReason}</ActionBarMuted>
                          ) : null}
                        </>
                      )}
                    </span>
                  </>
                }
                actions={
                  <Button
                    onClick={publish}
                    pending={flow.isPublishing}
                    pendingLabel="Publishing…"
                    disabledReason={
                      flow.isPublishing ? undefined : disabledReason
                    }
                  >
                    <UploadIcon aria-hidden data-icon="inline-start" />
                    {retry
                      ? "Retry publishing"
                      : `Publish ${includedAreas.length === 1 ? "1 area" : `${includedAreas.length} areas`} to Google`}
                  </Button>
                }
              />
            </div>
          )}
        </PageFrame>
      )}
    </ListingGate>
  )
}

export { ReviewPublish, pendingAreas }
