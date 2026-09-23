"use client"

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import type { MediaCategory } from "@/lib/api/location-media"
import { humaniseCategory } from "@/lib/locations/media-labels"

/** "Upload to Google?" — the last step before files leave the browser. */
export function UploadDialog({
  open,
  onOpenChange,
  files,
  category,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  files: readonly File[]
  category: MediaCategory
  pending: boolean
  onConfirm: () => void
}) {
  const count = files.length
  const noun = count === 1 ? "photo" : "photos"
  const categoryLabel = humaniseCategory(category)
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogTitle>
          {count === 1
            ? "Upload this file to Google?"
            : `Upload ${count} files to Google?`}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {count === 1
            ? `“${files[0]?.name}” will be added as a ${categoryLabel} photo on the Google Business Profile, where customers can see it straight away.`
            : `They will be added as ${categoryLabel} photos on the Google Business Profile, where customers can see them straight away.`}
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost">Cancel</Button>} />
          <Button onClick={onConfirm} pending={pending} disabled={count === 0}>
            Upload {count} {noun}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
