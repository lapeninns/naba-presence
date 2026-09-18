"use client"

import { CheckCircle2Icon, UploadIcon } from "lucide-react"
import Link from "next/link"
import { useCallback, useMemo, useState } from "react"

import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { ChangeDiff, type ChangeRow } from "@/components/editors/change-diff"
import { ListingGate } from "@/components/listings/listing-gate"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty } from "@/components/ui/empty"
import { Label } from "@/components/ui/label"
import { QueryError, QueryPending } from "@/components/ui/query-states"
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
  usePublishFlow,
  type PublishStep,
  type PublishStepResult,
} from "@/lib/editors/use-publish-flow"
import { listingHref } from "@/lib/listings/areas"
import { syncStatusLabel, syncStatusTone } from "@/lib/listings/health"
import { hoursChangeRows } from "@/lib/locations/hours-diff"
import { menuChangeRows } from "@/lib/locations/menu-diff"
import { queryKeys } from "@/lib/queries/keys"
import { useListingSummary } from "@/lib/queries/use-listing-summary"
import { useHours } from "@/lib/queries/use-location-hours"
import { useFoodMenus } from "@/lib/queries/use-location-menu"
import { useProfile } from "@/lib/queries/use-location-profile"

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
      before: field.googleValue ?? "—",
      after: field.canonicalValue ?? "—",
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
              label: "Publish name, description, phone and website",
              run: async () => {
                const fresh = await fetchProfile(locationId)
                const selected = fresh.fields
                  .filter(
                    (f) => PUBLISHABLE.includes(f.key) && f.status !== "in_sync"
                  )
                  .map((f) => f.key)
                if (selected.length === 0) return
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
    const rows = hoursChangeRows({
      draft: hours.canonical,
      google: hours.google,
      canonical: hours.canonical,
    })
    const needsAck =
      hours.status === "google_dirty" || hours.status === "conflict"
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
                label: "Publish the opening hours",
                run: async () => {
                  const fresh = await fetchHours(locationId)
                  if (fresh.updateMask.length === 0) return
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
                label: "Replace the food menu on Google",
                run: async () => {
                  const fresh = await fetchFoodMenus(locationId)
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

function StepGlyph({ status }: { status: PublishStepResult["status"] }) {
  const tone =
    status === "done"
      ? "healthy"
      : status === "failed"
        ? "at-risk"
        : status === "running"
          ? "pending"
          : "neutral"
  return <StatusPill variant="dot" tone={tone} />
}

function AreaSection({
  locationId,
  review,
  pending,
  error,
  onRetry,
}: {
  locationId: string
  review: AreaReview | null
  pending: boolean
  error: unknown
  onRetry: () => void
}) {
  if (error)
    return (
      <QueryError
        title="We couldn’t read this area from Google"
        cause={error}
        onRetry={onRetry}
      />
    )
  if (pending || !review)
    return <QueryPending label="Reading this area from Google…" />
  return (
    <section
      aria-labelledby={`review-${review.key}`}
      className="flex flex-col gap-3 rounded-(--np-radius-card) bg-surface p-(--np-card-pad)"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <h2
            id={`review-${review.key}`}
            className="text-title font-semibold text-ink"
          >
            {review.label}
          </h2>
          <StatusPill
            tone={syncStatusTone(
              review.needsAck
                ? "conflict"
                : review.rows.length
                  ? "core_dirty"
                  : "in_sync"
            )}
          >
            {review.rows.length === 0
              ? syncStatusLabel("in_sync")
              : review.needsAck
                ? "Google changed too"
                : syncStatusLabel("core_dirty")}
          </StatusPill>
        </div>
        <Link
          href={listingHref(locationId, review.key)}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          Edit
        </Link>
      </div>
      {review.rows.length === 0 ? (
        <p className="text-ui text-ink-muted">
          Nothing left to publish here: the saved copy already matches Google.
        </p>
      ) : (
        <ChangeDiff
          rows={review.rows}
          caption={`Changes to publish for ${review.label}`}
        />
      )}
    </section>
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
  const areas = summary.data ? pendingAreas(summary.data) : []
  const profile = useProfileReview(locationId, areas.includes("profile"))
  const hours = useHoursReview(locationId, areas.includes("hours"))
  const menu = useMenuReview(locationId, areas.includes("menu"))
  const [acknowledged, setAcknowledged] = useState(false)

  const reviews = [profile.review, hours.review, menu.review].filter(
    (review): review is AreaReview => review !== null
  )
  const rows = reviews.reduce((sum, review) => sum + review.rows.length, 0)
  const needsAck = reviews.some((review) => review.needsAck)
  const steps = reviews.flatMap((review) => review.steps)
  const loading =
    (areas.includes("profile") && profile.query.isPending) ||
    (areas.includes("hours") && hours.query.isPending) ||
    (areas.includes("menu") && menu.query.isPending)

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
  const blocked =
    loading ||
    steps.length === 0 ||
    (needsAck && !acknowledged) ||
    flow.isPublishing

  return (
    <ListingGate locationId={locationId} role={role}>
      {(entry) => (
        <PageFrame width="standard">
          <PageHeader
            eyebrow={
              <Link
                href={listingHref(locationId)}
                className="rounded-(--np-radius-tag) text-caption font-medium text-accent-ink underline-offset-4 focus-halo hover:underline"
              >
                ← {entry.name}
              </Link>
            }
            title="Review & publish"
            description={
              summary.isPending
                ? "Checking what is waiting…"
                : areas.length === 0
                  ? "Nothing is waiting to go to Google."
                  : `${areas.length === 1 ? "1 area has" : `${areas.length} areas have`} changes saved here that are not yet on Google.`
            }
            actions={
              <Link
                href={listingHref(locationId)}
                className={buttonVariants({ variant: "secondary" })}
              >
                Back to listing
              </Link>
            }
          />

          {summary.isError ? (
            <QueryError
              title="We couldn’t check this listing"
              cause={summary.error}
              onRetry={() => void summary.refetch()}
            />
          ) : summary.isPending ? (
            <QueryPending label="Checking what is waiting…" />
          ) : areas.length === 0 || done ? (
            <div className="rounded-(--np-radius-card) bg-surface">
              <Empty
                icon={<CheckCircle2Icon />}
                title={done ? "Published to Google" : "Everything is on Google"}
                description={
                  done
                    ? "Every change went out. The overview will show the new state."
                    : "There are no saved changes waiting. Edit an area and come back here to publish."
                }
                action={
                  <Link
                    href={listingHref(locationId)}
                    className={buttonVariants({ pill: true })}
                  >
                    Back to listing
                  </Link>
                }
              />
            </div>
          ) : (
            <>
              {areas.includes("profile") ? (
                <AreaSection
                  locationId={locationId}
                  review={profile.review}
                  pending={profile.query.isPending}
                  error={profile.query.error}
                  onRetry={() => void profile.query.refetch()}
                />
              ) : null}
              {areas.includes("hours") ? (
                <AreaSection
                  locationId={locationId}
                  review={hours.review}
                  pending={hours.query.isPending}
                  error={hours.query.error}
                  onRetry={() => void hours.query.refetch()}
                />
              ) : null}
              {areas.includes("menu") ? (
                <AreaSection
                  locationId={locationId}
                  review={menu.review}
                  pending={menu.query.isPending}
                  error={menu.query.error}
                  onRetry={() => void menu.query.refetch()}
                />
              ) : null}

              {needsAck ? (
                <div className="flex flex-col gap-3 rounded-(--np-radius-card) bg-warning-tint p-4 text-warning-ink">
                  <p className="text-ui">
                    Google changed some of these fields after they were edited
                    here. Publishing replaces Google’s values.
                  </p>
                  <Label className="flex items-start gap-2.5 text-ui text-warning-ink">
                    <Checkbox
                      checked={acknowledged}
                      onCheckedChange={(checked) =>
                        setAcknowledged(Boolean(checked))
                      }
                    />
                    <span>
                      I’ve read what Google has now and want to replace it.
                    </span>
                  </Label>
                </div>
              ) : null}

              {flow.results.length > 0 ? (
                <ol
                  className="flex flex-col gap-1.5 rounded-(--np-radius-card) bg-surface p-(--np-card-pad)"
                  aria-label="Publish progress"
                >
                  {flow.results.map((step) => (
                    <li
                      key={step.key}
                      className="flex items-center gap-2 text-ui"
                    >
                      <StepGlyph status={step.status} />
                      <span className="text-ink-muted">
                        {step.label}
                        <span className="sr-only">
                          {step.status === "done"
                            ? ": done"
                            : step.status === "failed"
                              ? ": failed"
                              : step.status === "running"
                                ? ": in progress"
                                : ": not started yet"}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : null}

              {flow.error ? (
                <Alert variant="destructive">
                  <AlertTitle>Publishing stopped</AlertTitle>
                  <AlertDescription>{flow.error}</AlertDescription>
                </Alert>
              ) : null}

              <div className="flex flex-wrap items-center justify-end gap-2">
                <p className="mr-auto text-caption text-ink-muted tabular-nums">
                  {loading
                    ? "Reading each area from Google…"
                    : rows === 1
                      ? "1 field will change on Google."
                      : `${rows} fields will change on Google.`}
                </p>
                <Button disabled={blocked} onClick={() => void flow.publish()}>
                  <UploadIcon
                    aria-hidden
                    strokeWidth={1.75}
                    data-icon="inline-start"
                  />
                  {flow.isPublishing ? "Publishing…" : "Publish to Google"}
                </Button>
              </div>
            </>
          )}
        </PageFrame>
      )}
    </ListingGate>
  )
}

export { ReviewPublish, pendingAreas }
