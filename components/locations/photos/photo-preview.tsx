"use client"

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  ImagesIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react"

import { StatusPill } from "@/components/ui/status-pill"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { MediaItem } from "@/lib/api/location-media"
import { formatMediaDate, humaniseCategory } from "@/lib/locations/media-labels"

function pixelSize(dimensions: unknown): string | null {
  if (!dimensions || typeof dimensions !== "object") return null
  const { widthPixels, heightPixels } = dimensions as Record<string, unknown>
  if (typeof widthPixels !== "number" || typeof heightPixels !== "number")
    return null
  return `${widthPixels} × ${heightPixels} px`
}

/**
 * The lightbox (reference `#lightbox`): one item full size, its provenance,
 * Previous/Next through the current page (also the arrow keys), and — for a
 * business photo — the actions that change Google, each saying so.
 *
 * `items` is the page being browsed, so the position reads "3 of 12" for
 * what the operator can see; the library's other pages are one Next away
 * in the grid.
 */
export function PhotoPreview({
  item,
  items,
  open,
  onOpenChange,
  onNavigate,
  onDelete,
  onUseAsLogo,
  writeReason,
  updating,
}: {
  item: MediaItem | null
  /** The items the lightbox steps through; defaults to the one item. */
  items?: readonly MediaItem[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onNavigate?: (item: MediaItem) => void
  onDelete?: (item: MediaItem) => void
  onUseAsLogo?: (item: MediaItem) => void
  /** Why this viewer cannot change photos; hides nothing, explains the lock. */
  writeReason?: string | null
  updating?: boolean
}) {
  if (!item) return null

  const list = items && items.length > 0 ? items : [item]
  const index = Math.max(
    0,
    list.findIndex((entry) => entry.id === item.id)
  )
  const previous = index > 0 ? list[index - 1] : null
  const next = index < list.length - 1 ? list[index + 1] : null

  const customer = item.ownership === "customer"
  const categoryLabel = humaniseCategory(item.category)
  const mediaKind = item.mediaFormat.toLowerCase()
  const created = formatMediaDate(item.createTime)
  const size = pixelSize(item.dimensions)
  const locked = Boolean(writeReason)
  const showActions = !customer && (onDelete || onUseAsLogo)

  const note = customer
    ? "Customer photos can’t be moved, deleted or used as your logo. If one breaks Google’s rules, report it on Google Maps."
    : locked
      ? writeReason
      : "Use as logo and Delete change the listing on Google straight away."

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="wide"
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" && previous && onNavigate) {
            event.preventDefault()
            onNavigate(previous)
          }
          if (event.key === "ArrowRight" && next && onNavigate) {
            event.preventDefault()
            onNavigate(next)
          }
        }}
      >
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>{categoryLabel}</DialogTitle>
            <StatusPill tone="outline" plain>
              {customer ? `Customer ${mediaKind}` : `Business ${mediaKind}`}
            </StatusPill>
          </div>
          <DialogDescription>
            {created
              ? `Added ${created}`
              : `${humaniseCategory(mediaKind)} from your Google listing`}
          </DialogDescription>
        </DialogHeader>

        <figure className="m-0 flex min-w-0 flex-col gap-3">
          <div className="grid min-h-48 place-items-center rounded-lg bg-surface-alt p-2">
            {item.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.thumbnailUrl}
                alt={item.description || `${categoryLabel} ${mediaKind}`}
                referrerPolicy="no-referrer"
                className="h-auto max-h-[min(58dvh,40rem)] w-auto max-w-full rounded-md object-contain"
              />
            ) : (
              <ImagesIcon
                aria-hidden
                className="size-8 text-ink-muted"
                strokeWidth={1.5}
              />
            )}
          </div>

          {list.length > 1 && onNavigate ? (
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!previous}
                onClick={() => previous && onNavigate(previous)}
              >
                <ChevronLeftIcon aria-hidden />
                Previous
              </Button>
              <span
                className="font-mono text-caption text-ink-muted tabular-nums"
                aria-live="polite"
              >
                {index + 1} of {list.length}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={!next}
                onClick={() => next && onNavigate(next)}
              >
                Next
                <ChevronRightIcon aria-hidden />
              </Button>
            </div>
          ) : null}

          <figcaption>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-ui">
              <dt className="text-ink-muted">Added by</dt>
              <dd className="text-ink">
                {customer ? "A customer" : "Your business"}
              </dd>
              {created ? (
                <>
                  <dt className="text-ink-muted">Added</dt>
                  <dd className="font-mono text-ink tabular-nums">{created}</dd>
                </>
              ) : null}
              <dt className="text-ink-muted">Category</dt>
              <dd className="text-ink">{categoryLabel}</dd>
              {size ? (
                <>
                  <dt className="text-ink-muted">Size</dt>
                  <dd className="font-mono text-ink tabular-nums">{size}</dd>
                </>
              ) : null}
              {item.googleUrl ? (
                <>
                  <dt className="text-ink-muted">On Google</dt>
                  <dd>
                    <a
                      href={item.googleUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-6 items-center gap-1.5 rounded-sm font-medium text-accent-ink underline underline-offset-3 focus-halo pointer-coarse:min-h-(--np-touch)"
                    >
                      Open original
                      <ExternalLinkIcon aria-hidden className="size-3.5" />
                    </a>
                  </dd>
                </>
              ) : null}
            </dl>
          </figcaption>
        </figure>

        <p role="note" className="text-caption text-ink-muted">
          {note}
        </p>

        {showActions ? (
          <DialogFooter className="sm:justify-between">
            {onDelete ? (
              <Button
                variant="danger-outline"
                disabled={locked || updating}
                onClick={() => onDelete(item)}
              >
                <Trash2Icon aria-hidden />
                Delete from Google
              </Button>
            ) : null}
            {onUseAsLogo && item.category !== "LOGO" ? (
              <Button
                variant="secondary"
                disabled={locked || updating}
                onClick={() => onUseAsLogo(item)}
              >
                <StarIcon aria-hidden />
                Use as logo
              </Button>
            ) : null}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
