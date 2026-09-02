"use client"

import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import {
  deleteMediaItem,
  type MediaItem,
  type MediaMutationResult,
} from "@/lib/api/location-media"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"

/** "Delete this photo from Google?" — open while `item` is set; owns the delete mutation. */
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
    successToast: "Photo deleted",
    onSuccess: onClose,
  })

  return (
    <OverwriteConfirmDialog
      open={item !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Delete this photo from Google?"
      description="This removes the photo from your Google Business Profile. It cannot be undone."
      confirmLabel="Delete"
      requireAcknowledgement={false}
      pending={remove.isPending}
      onConfirm={() => item && remove.mutate(item)}
    />
  )
}
