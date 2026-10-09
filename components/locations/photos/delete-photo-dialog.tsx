"use client"

import { ImagesIcon } from "lucide-react"

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  deleteMediaItem,
  type MediaItem,
  type MediaMutationResult,
} from "@/lib/api/location-media"
import { formatMediaDate, humaniseCategory } from "@/lib/locations/media-labels"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"

/**
 * "Delete this photo from Google?" — open while `item` is set; owns the
 * delete mutation.
 *
 * The library mirrors Google's own, so there is no "remove from NabaPresence
 * only": deleting here is deleting on Google, and the dialog says so in
 * words beside a thumbnail of the photo it acts on.
 */
export function DeletePhotoDialog({
  locationId,
  item,
  onClose,
  onDeleted,
}: {
  locationId: string
  item: MediaItem | null
  onClose: () => void
  /** Called after a successful delete, to re-read the library from Google. */
  onDeleted: () => void
}) {
  const remove = useResourceMutation<MediaMutationResult, MediaItem>({
    mutationFn: (target) =>
      deleteMediaItem(locationId, target.id, {
        expectedGoogleHash: target.googleHash,
      }),
    invalidate: onDeleted,
    successToast: (result) =>
      result.status === "succeeded"
        ? "Photo deleted from Google"
        : "Delete sent to Google",
    onSuccess: onClose,
  })

  const categoryLabel = item ? humaniseCategory(item.category) : ""
  const created = item ? formatMediaDate(item.createTime) : null

  return (
    <AlertDialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open && !remove.isPending) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogTitle>Delete this photo from Google?</AlertDialogTitle>
        <AlertDialogDescription>
          This removes it from the Google Business Profile straight away, so
          customers stop seeing it on Search and Maps. NabaPresence shows
          Google’s library, so there is no way to remove it here only. It can’t
          be undone.
        </AlertDialogDescription>
        {item ? (
          <div className="flex items-center gap-3">
            <span className="grid aspect-[4/3] w-24 shrink-0 place-items-center overflow-hidden rounded-md bg-fill">
              {item.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.thumbnailUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="size-full object-cover"
                />
              ) : (
                <ImagesIcon aria-hidden className="size-5 text-ink-muted" />
              )}
            </span>
            <span className="min-w-0 text-ui text-ink">
              {categoryLabel} {item.mediaFormat.toLowerCase()}
              {created ? (
                <span className="block text-caption text-ink-muted">
                  Added {created}
                </span>
              ) : null}
            </span>
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogClose
            render={<Button variant="ghost">Keep the photo</Button>}
          />
          <Button
            variant="danger"
            pending={remove.isPending}
            pendingLabel="Deleting from Google…"
            onClick={() => item && remove.mutate(item)}
          >
            Delete from Google
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
