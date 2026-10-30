"use client"

import { useQueryClient } from "@tanstack/react-query"
import { CircleAlertIcon, CircleCheckIcon, RefreshCwIcon } from "lucide-react"
import Link from "next/link"

import { LocationTab } from "@/components/locations/location-tab"
import { GoogleChangesPanel } from "@/components/locations/suggestions/google-changes-panel"
import {
  isBillingHold,
  SuggestionList,
} from "@/components/locations/suggestions/suggestion-list"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { countNoun } from "@/components/ui/count-text"
import { Empty } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { useToastManager } from "@/components/ui/toast"
import type { ImportReviewRefreshResponse } from "@/lib/contracts/location-import-review"
import { describeActionError } from "@/lib/errors/action-errors"
import { formatNumber } from "@/lib/format"
import { listingHref } from "@/lib/listings/areas"
import { queryKeys } from "@/lib/queries/keys"
import {
  useCheckGoogleChanges,
  useGoogleChanges,
} from "@/lib/queries/use-google-change-watch"
import {
  useImportReview,
  useRefreshImportReview,
} from "@/lib/queries/use-import-review"
import type { GoogleChangeCheckResponse } from "@/lib/contracts/google-change-watch"
import { WATCHED_FIELD_LABELS } from "@/lib/domain/google-change-watch-vocabulary"
import { useProfile } from "@/lib/queries/use-location-profile"
import { cn } from "@/lib/utils"

/**
 * Everything Google has changed that NabaPresence has not accepted yet.
 *
 * The decisions are per field and per menu item, and they belong together: an
 * operator working through them is doing one job, not visiting two editors to
 * find the queue hiding above each one's fields.
 */
export function SuggestionsTab({ locationId }: { locationId: string }) {
  return (
    <LocationTab
      locationId={locationId}
      loadingLabel="suggested updates"
      useResource={useProfile}
    >
      {({ data: profile, editReason }) => (
        <div className="flex flex-col gap-(--np-gap-section)">
          {/* One check for the whole tab, above everything it refreshes. */}
          <CheckGoogleRow locationId={locationId} editReason={editReason} />
          {/* Protected fields Google changed, then Google's suggestions. */}
          <GoogleChangesPanel
            locationId={locationId}
            editReason={isBillingHold(editReason) ? editReason : null}
          />
          <SuggestionsView
            locationId={locationId}
            canonicalRevision={profile.canonicalResource.revision}
            editReason={editReason}
          />
        </div>
      )}
    </LocationTab>
  )
}

/** The refresh route answers owners and admins only (refresh/route.ts). */
const CHECK_ROLE_REASON =
  "Only owners and admins can check Google for suggestions."

/**
 * What the check found, from the server's own counts: `raised` is the
 * suggestions it added or changed, so the same toast never stands for
 * both "nothing" and "five new".
 */
function checkResult(outcomes: ImportReviewRefreshResponse["outcomes"]) {
  const raised =
    (outcomes.profile?.raised ?? 0) + (outcomes.foodMenus?.raised ?? 0)
  return raised === 0
    ? "Nothing new since the last check."
    : `${countNoun(raised, "new suggestion")} to review.`
}

/** What the protected-field watch found, or nothing when it found nothing. */
function watchResult(data: GoogleChangeCheckResponse): string[] {
  const lines: string[] = []
  if (data.found > 0) {
    lines.push(`${countNoun(data.found, "protected field")} changed on Google.`)
  }
  if (data.unchecked.length > 0) {
    lines.push(
      `We couldn’t read ${data.unchecked
        .map((field) => WATCHED_FIELD_LABELS[field].toLowerCase())
        .join(
          ", "
        )} from Google, so ${data.unchecked.length === 1 ? "it wasn’t" : "they weren’t"} checked. Try again in a few minutes.`
    )
  }
  return lines
}

/**
 * The tab's one "Check Google now": it runs the protected-field watch and,
 * when suggested updates are on, the suggestions check, then says what both
 * found in a single toast.
 */
function CheckGoogleRow({
  locationId,
  editReason,
}: {
  locationId: string
  editReason: string | null
}) {
  const queryClient = useQueryClient()
  const toasts = useToastManager()
  const profileReview = useImportReview(locationId, "profile")
  const menuReview = useImportReview(locationId, "food_menus")
  const refresh = useRefreshImportReview(locationId)
  const watchCheck = useCheckGoogleChanges(locationId)
  // Unknown until the lists load: check suggestions too unless they're off.
  const suggestionsOff =
    profileReview.data !== undefined &&
    menuReview.data !== undefined &&
    !profileReview.data.importReviewEnabled &&
    !menuReview.data.importReviewEnabled
  const billingHold = isBillingHold(editReason)
  // A UI hint only: the routes stay the authority on who may check.
  const checkReason = editReason
    ? billingHold
      ? editReason
      : CHECK_ROLE_REASON
    : undefined

  const check = async () => {
    const [watch, suggestions] = await Promise.allSettled([
      watchCheck.mutateAsync(),
      suggestionsOff ? Promise.resolve(null) : refresh.mutateAsync("all"),
    ])
    if (suggestions.status === "fulfilled" && suggestions.value) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.listingSummary(locationId),
      })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.listingSummaries,
      })
    }
    if (watch.status === "rejected" && suggestions.status === "rejected") {
      toasts.add({
        title: describeActionError(suggestions.reason),
        type: "error",
      })
      return
    }
    const lines =
      watch.status === "fulfilled"
        ? watchResult(watch.value)
        : [
            `Protected fields weren’t checked. ${describeActionError(watch.reason)}`,
          ]
    if (suggestions.status === "rejected") {
      lines.push(
        `Suggestions weren’t checked. ${describeActionError(suggestions.reason)}`
      )
    } else if (suggestions.value) {
      lines.push(checkResult(suggestions.value.outcomes))
    } else if (lines.length === 0) {
      lines.push("No protected field changed.")
    }
    const partial =
      watch.status === "rejected" ||
      suggestions.status === "rejected" ||
      (watch.status === "fulfilled" && watch.value.unchecked.length > 0)
    toasts.add({
      title: "Checked with Google",
      description: lines.join(" "),
      type: partial ? "warning" : "info",
    })
  }

  return (
    <div
      data-slot="suggestions-check"
      className="flex flex-wrap items-center gap-x-3 gap-y-1"
    >
      <p className="min-w-0 grow basis-48 text-ui text-ink-muted">
        Where Google differs from ours: protected fields first, then suggested
        updates.
      </p>
      <Button
        variant="secondary"
        onClick={() => void check()}
        disabledReason={checkReason}
        pending={watchCheck.isPending || refresh.isPending}
        pendingLabel="Checking…"
      >
        <RefreshCwIcon aria-hidden />
        Check Google now
      </Button>
    </div>
  )
}

/** The shape of the loaded page: the summary line, then a group of rows. */
function SuggestionsSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      {/* The shapes say nothing to a screen reader; this line does. */}
      <p role="status" className="sr-only">
        Loading suggested updates…
      </p>
      <Skeleton className="h-6 w-2/3" />
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-4 w-1/4" />
        <ul className="flex flex-col divide-y divide-line-subtle border-y border-line-subtle desk:rounded-(--np-radius-card) desk:border desk:border-line desk:bg-surface">
          {[0, 1].map((index) => (
            <li
              key={index}
              className="flex flex-col gap-3 py-4 desk:px-(--np-card-pad)"
            >
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-(--np-control-h) w-40" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function SuggestionsView({
  locationId,
  canonicalRevision,
  editReason,
}: {
  locationId: string
  canonicalRevision: string
  editReason: string | null
}) {
  const profileReview = useImportReview(locationId, "profile")
  const menuReview = useImportReview(locationId, "food_menus")
  const watched = useGoogleChanges(locationId)

  if (profileReview.isPending || menuReview.isPending)
    return <SuggestionsSkeleton />

  const failed = [profileReview, menuReview].find((query) => query.isError)
  if (failed) {
    return (
      <Empty
        placement="page"
        tone="bad"
        icon={<CircleAlertIcon />}
        titleAs="h2"
        role="alert"
        title="We couldn’t load Google’s suggestions"
        description={`Nothing was accepted or ignored. ${describeActionError(failed.error)}`}
        // Outside the alert, so it reads what happened, not the button.
        actions={
          <Button
            variant="secondary"
            onClick={() => {
              void profileReview.refetch()
              void menuReview.refetch()
            }}
          >
            <RefreshCwIcon aria-hidden />
            Try again
          </Button>
        }
      />
    )
  }

  const profile = profileReview.data!
  const menu = menuReview.data!
  // A protected field Google changed is decided once, in the panel above,
  // not again here as a suggestion (the listing summary counts it the same
  // way, lib/server/location-summary.ts).
  const liveAbove = (watched.data?.changes ?? []).filter(
    (change) => change.status === "open" || change.status === "reverting"
  )
  const decidedAbove = new Set<string>(liveAbove.map((change) => change.field))
  const allPendingProfile = profile.importReviewEnabled
    ? profile.proposals.filter((p) => p.status === "pending")
    : []
  const pendingProfile = allPendingProfile.filter(
    (p) => !p.fieldKey || !decidedAbove.has(p.fieldKey)
  )
  const hiddenAbove = allPendingProfile.length - pendingProfile.length
  const pendingMenu = menu.importReviewEnabled
    ? menu.proposals.filter((p) => p.status === "pending")
    : []
  const total = pendingProfile.length + pendingMenu.length
  const enabled = profile.importReviewEnabled || menu.importReviewEnabled
  const billingHold = isBillingHold(editReason)

  // No count of its own: the panel above already says how many to decide.
  const decidedAboveNote =
    hiddenAbove > 0 ? (
      <p className="text-caption text-ink-muted">
        Suggestions for protected fields are decided above, under Protected
        fields Google changed.
      </p>
    ) : null

  const gate = editReason ? (
    <Alert variant="info">
      {billingHold ? (
        <>
          <AlertTitle>Suggestions can’t be decided right now</AlertTitle>
          <AlertDescription>{editReason}</AlertDescription>
        </>
      ) : (
        <>
          <AlertTitle>
            Only owners and admins can accept or ignore suggestions
          </AlertTitle>
          <AlertDescription>
            You can see what Google changed. Ask an owner or admin to decide.
          </AlertDescription>
        </>
      )}
    </Alert>
  ) : null

  if (!enabled) {
    return (
      <Empty
        placement="page"
        icon={<CircleCheckIcon />}
        titleAs="h2"
        title="Suggested updates aren’t checked for this listing"
        description={`NabaPresence isn’t comparing this listing with Google for suggested updates${
          // The panel above can still hold protected fields to decide.
          liveAbove.length === 0
            ? ", so there is nothing to review here"
            : ". Protected fields Google changed are still decided above"
        }. The check is switched off for this whole NabaPresence installation, so whoever runs it for your team can turn it on. Until then, the profile and menu editors still show where Google differs.`}
        action={
          <>
            <Link
              href={listingHref(locationId, "profile")}
              className={cn(buttonVariants({ variant: "secondary" }))}
            >
              Open the business profile
            </Link>
            <Link
              href={listingHref(locationId, "menu")}
              className={cn(buttonVariants({ variant: "ghost" }))}
            >
              Open the food menu
            </Link>
          </>
        }
      />
    )
  }

  if (total === 0) {
    return (
      <div className="flex flex-col gap-4">
        {gate}
        {decidedAboveNote}
        <Empty
          placement="page"
          tone="ok"
          icon={<CircleCheckIcon />}
          titleAs="h2"
          title="No suggestions from Google"
          description="When Google or a customer changes this listing on Google, the change shows up here for you to accept or ignore."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {gate}
      {decidedAboveNote}
      <div
        data-slot="suggestions-summary"
        className="flex flex-wrap items-center gap-x-3 gap-y-1"
      >
        <p className="min-w-0 grow basis-48 text-ui text-ink-muted">
          <span className="mr-1.5 align-baseline text-section font-semibold text-ink tabular-nums">
            {formatNumber(total)}
          </span>
          {total === 1 ? "suggestion" : "suggestions"} waiting
          {/* Only the parts with something in them. */}
          {pendingProfile.length > 0
            ? ` · ${formatNumber(pendingProfile.length)} business profile`
            : null}
          {pendingMenu.length > 0
            ? ` · ${formatNumber(pendingMenu.length)} food menu`
            : null}
        </p>
      </div>

      {pendingProfile.length > 0 ? (
        <SuggestionList
          locationId={locationId}
          resourceType="profile"
          proposals={pendingProfile}
          canonicalRevision={canonicalRevision}
          editDisabledReason={editReason}
          editorHref={listingHref(locationId, "profile")}
        />
      ) : null}
      {pendingMenu.length > 0 ? (
        <SuggestionList
          locationId={locationId}
          resourceType="food_menus"
          proposals={pendingMenu}
          canonicalRevision={canonicalRevision}
          editDisabledReason={editReason}
          editorHref={listingHref(locationId, "menu")}
        />
      ) : null}

      <p className="text-caption text-ink-muted">
        Accepting updates the copy NabaPresence holds; nothing is sent to
        Google. Ignoring keeps yours, to publish over Google’s later.
      </p>
    </div>
  )
}
