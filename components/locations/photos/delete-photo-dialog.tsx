"use client"

import { ImageOffIcon, ImagesIcon, RefreshCwIcon } from "lucide-react"
import { useState } from "react"

import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { answerOutcome } from "@/lib/editors/outcome"
import { ApiClientError } from "@/lib/api/client"
import {
  deleteMediaItem,
  type MediaItem,
  type MediaMutationResult,
} from "@/lib/api/location-media"
import { isUnconfirmedFailure } from "@/lib/errors/action-errors"
import { formatMediaDate, humaniseCategory } from "@/lib/locations/media-labels"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"

/** How the dialog closed, so the grid can put focus somewhere that stays. */
export type DeletePhotoOutcome = "deleted" | "parked" | "kept"

type DeleteError = {
  /** The item it was raised for; another photo opens without it. */
  forId: string
  /** The hash the refusal was for, so a refresh that changes it is seen. */
  hash: string
  message: string
  kind: "failed" | "unconfirmed" | "stale"
}

/**
 * "Delete this interior photo from Google?" — open while `item` is set; owns
 * the delete mutation.
 *
 * The library mirrors Google's own, so there is no "remove from NabaPresence
 * only": deleting here is deleting on Google, and the dialog says so in
 * words beside a thumbnail of the photo it acts on.
 *
 * A refusal stays in the dialog as well as in the toast, with its way out:
 * an unconfirmed delete is safe to send again (the retry carries the same
 * intent, so the server answers from its receipt), and a photo that changed
 * on Google since it was loaded can be re-read from here.
 */
export function DeletePhotoDialog({
  locationId,
  item,
  onClose,
  onDeleted,
  onRefresh,
  refreshing = false,
  lost = false,
  finalFocus,
}: {
  locationId: string
  item: MediaItem | null
  onClose: (outcome: DeletePhotoOutcome) => void
  /** Called after a successful delete, to re-read the library from Google. */
  onDeleted: () => void
  /** Re-reads the library from Google after a stale refusal. */
  onRefresh?: () => void
  refreshing?: boolean
  /** The refresh came back without this photo on its first page. */
  lost?: boolean
  /** Where focus goes once the dialog has closed (Base UI `finalFocus`). */
  finalFocus?: () => HTMLElement | boolean | null
}) {
  const [error, setError] = useState<DeleteError | null>(null)
  // The last photo asked about, so the words stay put while the dialog
  // animates closed after `item` has gone.
  const [shown, setShown] = useState<MediaItem | null>(item)
  if (item && item !== shown) setShown(item)

  const remove = useResourceMutation<MediaMutationResult, MediaItem>({
    mutationFn: (target, intent) =>
      deleteMediaItem(
        locationId,
        target.id,
        { expectedGoogleHash: target.googleHash },
        { intentId: intent.intentId }
      ),
    invalidate: onDeleted,
    successToast: (result) => {
      const outcome = answerOutcome(result)
      return outcome === "confirmed_applied"
        ? {
            outcome,
            title: "Photo deleted from Google",
            description:
              "Customers may still see it on Maps for a few minutes.",
          }
        : {
            outcome,
            title: "Delete sent to Google",
            description:
              "Google hasn’t confirmed it yet. Refresh in a moment to check.",
          }
    },
    onSuccess: () => close("deleted"),
    onParked: () => close("parked"),
    onError: (failure, message, target) =>
      setError({
        forId: target.id,
        hash: target.googleHash,
        message,
        kind: isUnconfirmedFailure(failure)
          ? "unconfirmed"
          : failure instanceof ApiClientError && failure.code === "media_stale"
            ? "stale"
            : "failed",
      }),
  })

  function close(outcome: DeletePhotoOutcome) {
    setError(null)
    onClose(outcome)
  }

  const photo = item ?? shown
  const categoryLabel = photo ? humaniseCategory(photo.category) : ""
  const mediaKind = photo ? photo.mediaFormat.toLowerCase() : "photo"
  const created = photo ? formatMediaDate(photo.createTime) : null
  const shownError = error && photo && error.forId === photo.id ? error : null
  // A refresh brought Google's current version: the refusal is answered,
  // and the person confirms against the photo as it is now.
  const refreshed =
    shownError?.kind === "stale" && photo
      ? photo.googleHash !== shownError.hash
      : false
  const unconfirmed = shownError?.kind === "unconfirmed"

  return (
    <AlertDialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open && !remove.isPending) close("kept")
      }}
    >
      <AlertDialogContent finalFocus={finalFocus}>
        <AlertDialogTitle>
          {categoryLabel
            ? `Delete this ${categoryLabel.toLowerCase()} ${mediaKind} from Google?`
            : `Delete this ${mediaKind} from Google?`}
        </AlertDialogTitle>
        <AlertDialogDescription>
          Customers stop seeing it on Search and Maps, usually within a few
          minutes. NabaPresence shows Google’s own library, so it can’t be
          removed here only, and it can’t be undone.
        </AlertDialogDescription>
        {photo ? (
          <div className="flex items-center gap-3">
            <span className="grid aspect-4/3 w-24 shrink-0 place-items-center overflow-hidden rounded-md bg-fill">
              <DeleteThumbnail item={photo} />
            </span>
            <span className="min-w-0 text-ui text-ink">
              {categoryLabel} {mediaKind}
              {created ? (
                <span className="block text-caption text-ink-muted tabular-nums">
                  Added {created}
                </span>
              ) : null}
            </span>
          </div>
        ) : null}
        {/* Not live: the toast has already announced the refusal. This is
            where it stays, with what to do next. */}
        {shownError && lost ? (
          <Alert variant="info">
            <AlertDescription>
              Google’s first page of photos doesn’t include this one any more.
              Close this, find the photo in the library, then delete it from
              there.
            </AlertDescription>
          </Alert>
        ) : shownError && !refreshed ? (
          <Alert variant="destructive" live={false}>
            <AlertTitle>
              {unconfirmed
                ? "We couldn’t confirm the delete"
                : "The photo wasn’t deleted"}
            </AlertTitle>
            <AlertDescription>
              {unconfirmed
                ? "Google may already have removed it. Trying again is safe: it won’t delete twice."
                : shownError.message}
            </AlertDescription>
            {shownError.kind === "stale" && onRefresh ? (
              <AlertActions>
                <Button
                  size="sm"
                  variant="secondary"
                  pending={refreshing}
                  pendingLabel="Refreshing…"
                  onClick={onRefresh}
                >
                  <RefreshCwIcon aria-hidden />
                  Refresh from Google
                </Button>
              </AlertActions>
            ) : null}
          </Alert>
        ) : null}
        {refreshed ? (
          <Alert variant="info">
            <AlertDescription>
              This is Google’s latest version of the photo. Check it’s the one
              you mean, then delete it.
            </AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogClose
            render={
              // Nothing can close mid-delete, so the answer says so too.
              <Button variant="ghost" disabled={remove.isPending}>
                Keep the photo
              </Button>
            }
          />
          <Button
            variant="danger"
            disabled={lost && shownError?.kind === "stale"}
            pending={remove.isPending}
            pendingLabel="Deleting from Google…"
            onClick={() => {
              if (!item) return
              setError(null)
              remove.mutate(item)
            }}
          >
            {unconfirmed ? "Try again" : "Delete from Google"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** The photo being deleted, or what stands in for it when Google's link fails. */
function DeleteThumbnail({ item }: { item: MediaItem }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  if (!item.thumbnailUrl)
    return <ImagesIcon aria-hidden className="size-5 text-ink-muted" />
  if (failedUrl === item.thumbnailUrl)
    return (
      <ImageOffIcon
        aria-hidden
        className="size-5 text-ink-muted"
        strokeWidth={1.5}
      />
    )
  const url = item.thumbnailUrl
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailedUrl(url)}
      className="size-full object-cover"
    />
  )
}
