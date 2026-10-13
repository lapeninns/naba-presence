"use client"

import { ImagesIcon } from "lucide-react"

import {
  formatUploadSize,
  UploadFileCard,
} from "@/components/locations/photos/upload-file-card"
import type { MediaCategory } from "@/lib/api/location-media"
import { humaniseCategory } from "@/lib/locations/media-labels"

/**
 * "Upload to Google?" — the last step before files leave the browser, drawn
 * as the second step of the add-media dialog (never a dialog stacked on top
 * of it). The caller owns the title, the step's buttons and the upload.
 */
export function uploadReviewTitle(count: number) {
  return count === 1
    ? "Upload this file to Google?"
    : `Upload ${count} files to Google?`
}

export function UploadReview({
  files,
  previews = [],
  category,
}: {
  files: readonly File[]
  /** Thumbnail URLs, index-aligned with `files` (null where there is none). */
  previews?: readonly (string | null)[]
  category: MediaCategory
}) {
  const count = files.length
  const categoryLabel = humaniseCategory(category)
  return (
    <div className="flex flex-col gap-3">
      <p className="text-ui text-ink">
        {count === 1
          ? `“${files[0]?.name}” will be added to the Google Business Profile under “${categoryLabel}”, where customers can see it straight away.`
          : `They will be added to the Google Business Profile under “${categoryLabel}”, where customers can see them straight away.`}
      </p>
      {/* The same attachment cards as the pick step, read-only (no
          remove): exactly the files that are about to leave. */}
      <ul aria-label="Photos to upload" className="grid gap-2 sm:grid-cols-2">
        {files.map((file, index) => (
          <UploadFileCard
            key={`${index}-${file.name}`}
            name={file.name}
            previewUrl={previews[index] ?? null}
            previewAlt={file.name}
            fallbackIcon={<ImagesIcon aria-hidden className="size-4" />}
            meta={
              <span className="tabular-nums">
                {formatUploadSize(file.size)}
              </span>
            }
          />
        ))}
      </ul>
    </div>
  )
}
