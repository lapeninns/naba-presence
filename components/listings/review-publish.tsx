"use client"

import {
  CheckIcon,
  ClockIcon,
  EyeIcon,
  PencilIcon,
  RefreshCwIcon,
  StoreIcon,
  UnplugIcon,
  UploadIcon,
  UtensilsIcon,
  type LucideIcon,
} from "lucide-react"
import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"

import { ChangeDiff } from "@/components/editors/change-diff"
import { ListingGate } from "@/components/listings/listing-gate"
import {
  useHoursReview,
  useMenuReview,
  useProfileReview,
  type AreaReview,
} from "@/components/listings/review-publish-reads"
import { ActionBar, ActionBarMuted } from "@/components/ui/action-bar"
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { cardClassName } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty } from "@/components/ui/empty"
import { ListRow } from "@/components/ui/list-row"
import {
  PublishSteps,
  type PublishStep as PublishStepRow,
} from "@/components/ui/publish-steps"
import { SectionHeader } from "@/components/ui/section-header"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { StatusPill } from "@/components/ui/status-pill"
import { describeOutcome } from "@/lib/editors/outcome"
import {
  publishOutcome,
  stepOutcome,
  usePublishFlow,
  type PublishStepResult,
} from "@/lib/editors/use-publish-flow"
import { describeActionError } from "@/lib/errors/action-errors"
import { formatNumber } from "@/lib/format"
import { listingHref } from "@/lib/listings/areas"
import { syncStatusLabel } from "@/lib/listings/health"
import { pendingAreas, type AreaKey } from "@/lib/listings/pending-areas"
import { queryKeys } from "@/lib/queries/keys"
import { useListingSummary } from "@/lib/queries/use-listing-summary"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { cn } from "@/lib/utils"
import { useWorkspaceMode } from "@/lib/workspace/mode"

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

/** The neutral leading mark of each area's row (an icon, never a status). */
const AREA_ICON: Record<AreaKey, LucideIcon> = {
  profile: StoreIcon,
  hours: ClockIcon,
  menu: UtensilsIcon,
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
  const Icon = AREA_ICON[area]
  const headingId = `review-${area}`
  const conflict = review?.needsAck ?? false
  return (
    <section
      aria-labelledby={headingId}
      data-slot="review-area"
      data-area={area}
      className={cardClassName({ className: "flex flex-col overflow-hidden" })}
    >
      {/* The row: a neutral area mark, the area and its state in words,
          how many fields change, and the way to edit it. It carries its
          own control (Edit), so the row itself is not one target. */}
      <ListRow
        interactive={false}
        emphasis="neutral"
        className="px-4"
        wrapperClassName="border-b border-line after:hidden"
        leading={
          <span className="flex size-7 items-center justify-center rounded-full bg-fill-secondary text-ink-muted">
            <Icon className="size-4" strokeWidth={1.75} />
          </span>
        }
        // A span with the heading role: the row's title slot is phrasing
        // content, so an <h2> cannot sit in it; the outline is unchanged.
        title={
          <span
            role="heading"
            aria-level={2}
            id={headingId}
            className="text-title font-semibold"
          >
            {label}
          </span>
        }
        meta={
          <Link
            href={listingHref(locationId, area)}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            aria-label={`Edit ${label.toLowerCase()}`}
          >
            <PencilIcon aria-hidden />
            Edit
          </Link>
        }
        subtitle={
          review && review.rows.length > 0 ? (
            <span className="text-caption text-ink-muted tabular-nums">
              {review.rows.length === 1
                ? "1 field"
                : `${formatNumber(review.rows.length)} fields`}
            </span>
          ) : undefined
        }
        trailing={
          review ? (
            review.blockedReason ? (
              <StatusPill tone="attention">Needs review</StatusPill>
            ) : review.rows.length === 0 ? (
              <StatusPill tone="healthy">
                {syncStatusLabel("in_sync")}
              </StatusPill>
            ) : conflict ? (
              <StatusPill tone="attention">Google changed too</StatusPill>
            ) : (
              <StatusPill tone="pending">Not on Google yet</StatusPill>
            )
          ) : undefined
        }
      />
      {include && review && review.rows.length > 0 ? (
        <div className="border-b border-line bg-surface-alt px-4 py-2.5">
          <Checkbox
            checked={include.checked && !review.blockedReason}
            disabled={include.disabled || Boolean(review.blockedReason)}
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
        {review?.blockedReason ? (
          <Alert variant="warning">
            <AlertTitle>Hours need review before publishing</AlertTitle>
            <AlertDescription>{review.blockedReason}</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Empty
            role="alert"
            variant="error"
            size="sm"
            title={`We couldn’t read ${label.toLowerCase()} from Google`}
            description={`So its changes can’t be shown or published. ${describeActionError(error)}`}
            action={
              <Button variant="secondary" size="sm" onClick={onRetry}>
                <RefreshCwIcon aria-hidden />
                Try again
              </Button>
            }
          />
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
            <ChangeDiff
              rows={review.rows}
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
function toStepRows(results: PublishStepResult[]): PublishStepRow[] {
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
    if (step.status === "done") {
      // The server's answer for the step (stepOutcome): only a write Google
      // was read back holding may say live; anything less says what it is.
      const outcome = stepOutcome(step) ?? "sent"
      return {
        id: step.key,
        label: step.label,
        state: outcome,
        detail:
          outcome === "confirmed_applied"
            ? "Google accepted it and read it back as sent. It can take a few minutes to show on Maps and Search."
            : describeOutcome(outcome).description,
      }
    }
    if (step.status === "failed")
      return {
        id: step.key,
        label: step.label,
        // "Not confirmed" rather than "Failed" when the change may have
        // landed: retrying then resends the same intent.
        state: stepOutcome(step) ?? "failed",
        errorCode: step.code,
        // The reason alone, once: the banner below says what happened to the
        // rest and what to do next.
        detail:
          step.reason ?? step.message ?? "Google didn’t accept this change.",
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
          className={cardClassName({ className: "flex flex-col gap-3 p-4" })}
        >
          <Skeleton className="h-4.5 w-1/3" />
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
    (review) => !excluded.includes(review.key) && !review.blockedReason
  )
  const includedAreas = areas.filter(
    (area) =>
      !excluded.includes(area) &&
      !allReviews.find((review) => review.key === area)?.blockedReason
  )
  const rows = reviews.reduce((sum, review) => sum + review.rows.length, 0)
  const needsAck = reviews.some((review) => review.needsAck)
  const ackFields = reviews.flatMap((review) =>
    review.rows
      .filter((row) => row.state === "conflict")
      .map((row) => row.field)
  )
  const unresolved = reviews.flatMap((review) =>
    review.rows.filter((row) => row.blocking)
  )
  const reviewSignature = JSON.stringify(reviews.map((review) => review.rows))
  const [ackSignature, setAckSignature] = useState(reviewSignature)
  if (ackSignature !== reviewSignature) {
    setAckSignature(reviewSignature)
    setAcknowledged(false)
  }
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
    successToast: (outcome) => ({ outcome }),
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
  const business = useWorkspaceMode() === "business"
  const canManage = role === "owner" || role === "admin"
  const cannotPublish = caps.data ? !caps.data.canPublish : false
  // A role that can't edit has nothing to edit and come back with, so the
  // empty state doesn't send it off to edit.
  const cannotEdit = caps.data ? !caps.data.canEditCanonical : false

  const disabledReason = paused
    ? canManage
      ? business
        ? "Publishing is paused until your Google login is reconnected."
        : "Publishing is paused until the client’s Google login is reconnected."
      : business
        ? "Publishing is paused until an owner or admin reconnects your Google login."
        : "Publishing is paused until an owner or admin reconnects the client’s Google login."
    : cannotPublish
      ? "You can review these changes, but publishing is limited to people with publish access."
      : loading
        ? "Wait until every area has been read from Google."
        : unreadable.length > 0
          ? `Couldn’t read ${AREA_LABEL[unreadable[0]!].toLowerCase()} from Google. Try again above first.`
          : unresolved.length > 0
            ? "Resolve the menu comparison before publishing."
            : includedAreas.length === 0
              ? (allReviews.find((review) => review.blockedReason)
                  ?.blockedReason ?? "Include at least one area to publish.")
              : steps.length === 0
                ? "Nothing is left to publish."
                : needsAck && !acknowledged
                  ? "Confirm the Google change first."
                  : undefined

  const publish = () => void flow.publish()
  const retry = flow.error && !flow.isPublishing ? publish : null
  const nothingSent = done && flow.results.every((step) => step.noop === true)

  // A failure moves focus to its banner, so a keyboard or screen-reader user
  // lands on what stopped and what to do next rather than on a now-idle
  // button.
  const failureRef = useRef<HTMLDivElement>(null)
  const failed = Boolean(flow.error) && !flow.isPublishing
  const failedAt = flow.results.findIndex((step) => step.status === "failed")
  const failedStep = failedAt === -1 ? undefined : flow.results[failedAt]
  // Sent but not confirmed, or not answered at all: it may have landed.
  const mayHaveLanded = Boolean(failedStep?.unconfirmed)
  const earlierSent = flow.results
    .slice(0, Math.max(failedAt, 0))
    .some(
      (step) => step.status === "done" && !step.noop && step.kind !== "local"
    )
  useEffect(() => {
    if (failed) failureRef.current?.focus()
  }, [failed])

  return (
    <ListingGate locationId={locationId} role={role}>
      {(entry) => (
        <>
          {summary.isError && !summary.data ? (
            <Empty
              variant="error"
              framed
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
          ) : summary.isPending ? (
            <ReviewSkeleton />
          ) : areas.length === 0 || done ? (
            <div className="flex flex-col gap-4">
              {done ? (
                <PublishSteps
                  aria-label="Publish results"
                  steps={toStepRows(flow.results)}
                />
              ) : null}
              <Empty
                variant="empty"
                framed
                tone="ok"
                icon={<CheckIcon />}
                titleAs="h2"
                title={
                  nothingSent
                    ? "Nothing needed sending"
                    : done
                      ? describeOutcome(publishOutcome(flow.results)).title
                      : "Nothing to publish"
                }
                description={
                  nothingSent
                    ? "Every area already matched Google when it was checked, so nothing was sent."
                    : done
                      ? publishOutcome(flow.results) === "confirmed_applied"
                        ? "Google accepted every change and read it back as sent. The overview and the board now show the new state."
                        : "Google accepted every change. Some haven’t been read back yet, so check the listing before relying on them."
                      : cannotEdit
                        ? `Nothing is waiting to go to Google for ${entry.name}.`
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
          ) : (
            <div className="flex flex-col gap-4">
              {paused ? (
                <Alert variant="destructive" icon={<UnplugIcon aria-hidden />}>
                  <AlertTitle>Publishing is paused for {entry.name}</AlertTitle>
                  <AlertDescription>
                    {business ? "Your" : "The client’s"} Google login needs
                    reconnecting, so Google can’t be read or written. Your saved
                    changes are kept.{" "}
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

              {/* The areas as one labelled list, in publish order. "To review",
                  not "waiting": an area here can already be in sync. */}
              <div className="flex flex-col gap-2">
                <p
                  id="review-areas-label"
                  className="text-caption font-medium text-ink-muted"
                >
                  Areas to review ·{" "}
                  <span className="tabular-nums">
                    {areas.length === 1
                      ? "1 area"
                      : `${formatNumber(areas.length)} areas`}
                  </span>
                </p>
                <ul
                  aria-labelledby="review-areas-label"
                  className="flex flex-col gap-3"
                >
                  {areas.map((area) => {
                    const source =
                      area === "profile"
                        ? profile
                        : area === "hours"
                          ? hours
                          : menu
                    return (
                      <li key={area}>
                        <AreaSection
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
                      </li>
                    )
                  })}
                </ul>
              </div>

              {unresolved.length > 0 ? (
                <Alert variant="warning">
                  <AlertTitle>
                    Resolve this comparison before publishing
                  </AlertTitle>
                  <AlertDescription>
                    {[
                      ...new Set(unresolved.map((row) => row.explanation)),
                    ].join(" ")}
                  </AlertDescription>
                </Alert>
              ) : null}
              {needsAck ? (
                <Alert variant="warning">
                  <AlertTitle>
                    Google holds a different version of {listFields(ackFields)}
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
                    steps={toStepRows(flow.results)}
                  />
                </section>
              ) : null}

              {flow.error && !flow.isPublishing ? (
                <div
                  ref={failureRef}
                  tabIndex={-1}
                  className="rounded-(--np-radius-card) focus-halo"
                >
                  <Alert variant="destructive">
                    <AlertTitle>
                      {`Publishing stopped at “${failedStep?.label ?? "a step"}”`}
                    </AlertTitle>
                    <AlertDescription>
                      {earlierSent
                        ? "Earlier steps were sent to Google. "
                        : null}
                      {mayHaveLanded
                        ? failedStep?.kind === "local"
                          ? "Reload to check it saved, then retry publishing. "
                          : "Check Google, then retry publishing. "
                        : "Retry publishing when you’re ready. "}
                      Steps after it weren’t sent, and your saved copy is kept.
                    </AlertDescription>
                  </Alert>
                </div>
              ) : null}

              {/* Docked to the bottom edge on a phone (the tab bar steps
                  aside, and the spacer, scroll padding and toasts follow its
                  measured height); `statusRow` gives the status its own row
                  there, since "Publish N areas to Google" leaves it no room
                  beside it. On a desk it sticks above the bottom edge only
                  where the window is tall enough to leave the content room
                  (the `controls` variant), and is inline on short screens. */}
              <ActionBar
                dock
                statusRow
                sticky={false}
                safeArea={false}
                className="controls:sticky controls:bottom-3"
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
                          <span className="tabular-nums">
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
                primary={
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
        </>
      )}
    </ListingGate>
  )
}

export { ReviewPublish }
