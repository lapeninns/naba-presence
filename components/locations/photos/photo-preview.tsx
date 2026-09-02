"use client"

import {
  ExternalLinkIcon,
  ImagesIcon,
  StoreIcon,
  UserRoundIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { MediaItem } from "@/lib/api/location-media"
import { formatMediaDate, humaniseCategory } from "@/lib/locations/media-labels"

/** Full-size view of one item with its provenance and a link to the Google original. */
export function PhotoPreview({
  item,
  open,
  onOpenChange,
}: {
  item: MediaItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (!item) return null

  const customer = item.ownership === "customer"
  const categoryLabel = humaniseCategory(item.category)
  const mediaKind = item.mediaFormat.toLowerCase()
  const created = formatMediaDate(item.createTime)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(92vh,52rem)] gap-4 overflow-y-auto p-3 sm:max-w-4xl sm:p-4">
        <DialogHeader className="pr-10">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>{categoryLabel}</DialogTitle>
            <Badge variant={customer ? "outline" : "secondary"}>
              {customer ? `Customer ${mediaKind}` : `Business ${mediaKind}`}
            </Badge>
          </div>
          <DialogDescription>
            {created
              ? `Added ${created}`
              : `${humaniseCategory(mediaKind)} from your Google listing`}
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-hidden rounded-(--nr-radius-field) bg-black/90">
          {item.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.thumbnailUrl}
              alt={`${categoryLabel} ${mediaKind}`}
              referrerPolicy="no-referrer"
              className="max-h-[min(70vh,40rem)] w-full object-contain"
            />
          ) : (
            <div className="flex min-h-72 items-center justify-center text-white/60">
              <ImagesIcon aria-hidden className="size-8" />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-(--nr-radius-field) bg-muted/50 px-3 py-2 text-caption text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            {customer ? (
              <UserRoundIcon aria-hidden className="size-3.5" />
            ) : (
              <StoreIcon aria-hidden className="size-3.5" />
            )}
            {customer ? "Shared by a customer" : "Uploaded by your business"}
          </span>
          {item.googleUrl ? (
            <a
              href={item.googleUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 font-medium text-foreground hover:underline"
            >
              Open original
              <ExternalLinkIcon aria-hidden className="size-3.5" />
            </a>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
