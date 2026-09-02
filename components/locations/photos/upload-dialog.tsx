"use client"

import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import type { MediaCategory } from "@/lib/api/location-media"
import { humaniseCategory } from "@/lib/locations/media-labels"

/** "Upload this file to Google?" — the last step before a file leaves the browser. */
export function UploadDialog({
  open,
  onOpenChange,
  file,
  category,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  file: File | null
  category: MediaCategory
  pending: boolean
  onConfirm: () => void
}) {
  return (
    <OverwriteConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Upload this file to Google?"
      description={
        file
          ? `“${file.name}” will be added as a ${humaniseCategory(category)} photo on your Google Business Profile.`
          : ""
      }
      confirmLabel="Upload"
      requireAcknowledgement={false}
      pending={pending}
      onConfirm={onConfirm}
    />
  )
}
