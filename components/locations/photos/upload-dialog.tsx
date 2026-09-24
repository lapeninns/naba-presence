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
  previews = [],
  category,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  files: readonly File[]
  /** Thumbnail URLs, index-aligned with `files` (null where there is none). */
  previews?: readonly (string | null)[]
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
            ? `“${files[0]?.name}” will be added to the Google Business Profile under “${categoryLabel}”, where customers can see it straight away.`
            : `They will be added to the Google Business Profile under “${categoryLabel}”, where customers can see them straight away.`}
        </AlertDialogDescription>
        {previews.some(Boolean) ? (
          <ul
            aria-label="Photos to upload"
            className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2"
          >
            {files.map((file, index) => (
              <li
                key={`${index}-${file.name}`}
                className="aspect-square overflow-hidden rounded-md bg-fill"
              >
                {previews[index] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previews[index]!}
                    alt={file.name}
                    className="size-full object-cover"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
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
