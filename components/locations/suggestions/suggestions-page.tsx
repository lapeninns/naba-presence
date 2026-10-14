"use client"

import { useQueryClient } from "@tanstack/react-query"
import { CircleAlertIcon, CircleCheckIcon, RefreshCwIcon } from "lucide-react"
import Link from "next/link"

import { LocationTab } from "@/components/locations/location-tab"
import { SuggestionList } from "@/components/locations/suggestions/suggestion-list"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { useToastManager } from "@/components/ui/toast"
import { describeActionError } from "@/lib/errors/action-errors"
import { formatNumber } from "@/lib/format"
import { listingHref } from "@/lib/listings/areas"
import { queryKeys } from "@/lib/queries/keys"
import {
  useImportReview,
  useRefreshImportReview,
} from "@/lib/queries/use-import-review"
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
        <SuggestionsView
          locationId={locationId}
          canonicalRevision={profile.canonicalResource.revision}
          editReason={editReason}
        />
      )}
    </LocationTab>
  )
}

/** The shape of the loaded page: the summary line, then a group of rows. */
function SuggestionsSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
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
  const queryClient = useQueryClient()
  const toasts = useToastManager()
  const profileReview = useImportReview(locationId, "profile")
  const menuReview = useImportReview(locationId, "food_menus")
  const refresh = useRefreshImportReview(locationId)

  const refreshFromGoogle = (resourceType: "profile" | "food_menus" | "all") =>
    refresh.mutate(resourceType, {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.listingSummary(locationId),
        })
        void queryClient.invalidateQueries({
          queryKey: queryKeys.listingSummaries,
        })
        toasts.add({
          title: "Checked with Google",
          description:
            "Anything Google changed since the last check is listed here.",
          type: "info",
        })
      },
      onError: (error) =>
        toasts.add({ title: describeActionError(error), type: "error" }),
    })

  if (profileReview.isPending || menuReview.isPending)
    return <SuggestionsSkeleton />

  const failed = [profileReview, menuReview].find((query) => query.isError)
  if (failed) {
    return (
      <Empty
        framed
        tone="bad"
        icon={<CircleAlertIcon />}
        titleAs="h2"
        title="We couldn’t load Google’s suggestions"
        description={`Nothing was accepted or ignored. ${describeActionError(failed.error)}`}
        action={
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
  const pendingProfile = profile.importReviewEnabled
    ? profile.proposals.filter((p) => p.status === "pending")
    : []
  const pendingMenu = menu.importReviewEnabled
    ? menu.proposals.filter((p) => p.status === "pending")
    : []
  const total = pendingProfile.length + pendingMenu.length
  const enabled = profile.importReviewEnabled || menu.importReviewEnabled
  const refreshing = refresh.isPending

  const gate = editReason ? (
    <Alert variant="info">
      <AlertTitle>
        Only owners and admins can accept or ignore suggestions
      </AlertTitle>
      <AlertDescription>
        You can see what Google changed. Ask an owner or admin to decide.
      </AlertDescription>
    </Alert>
  ) : null

  if (!enabled) {
    return (
      <Empty
        framed
        icon={<CircleCheckIcon />}
        titleAs="h2"
        title="Suggested updates aren’t checked for this listing"
        description="NabaPresence isn’t comparing this listing with Google for suggested updates, so there is nothing to review here. The check is switched off for this whole NabaPresence installation, so whoever runs it for your team can turn it on. Until then, the profile and menu editors still show where Google differs."
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
        <Empty
          framed
          tone="ok"
          icon={<CircleCheckIcon />}
          titleAs="h2"
          title="No suggestions from Google"
          description="When Google or a customer changes this listing on Google, the change shows up here for you to accept or ignore."
          action={
            <Button
              variant="secondary"
              onClick={() => refreshFromGoogle("all")}
              pending={refreshing}
              pendingLabel="Checking…"
            >
              <RefreshCwIcon aria-hidden />
              Check Google now
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {gate}
      <div
        data-slot="suggestions-summary"
        className="flex flex-wrap items-center gap-x-3 gap-y-1"
      >
        <p className="min-w-0 grow basis-48 text-ui text-ink-muted">
          <span className="mr-1.5 align-baseline text-section font-semibold text-ink tabular-nums">
            {formatNumber(total)}
          </span>
          {total === 1 ? "suggestion" : "suggestions"} waiting ·{" "}
          {formatNumber(pendingProfile.length)} business profile ·{" "}
          {formatNumber(pendingMenu.length)} food menu
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refreshFromGoogle("all")}
          pending={refreshing}
          pendingLabel="Checking…"
        >
          <RefreshCwIcon aria-hidden />
          Refresh from Google
        </Button>
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
