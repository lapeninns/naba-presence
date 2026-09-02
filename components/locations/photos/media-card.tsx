"use client"

import {
  ImagesIcon,
  Maximize2Icon,
  StoreIcon,
  Trash2Icon,
  UserRoundIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { MediaCategory, MediaItem } from "@/lib/api/location-media"
import {
  humaniseCategory,
  isPatchableMediaCategory,
} from "@/lib/locations/media-labels"

/** One library tile: thumbnail, ownership badge, and (for merchant media) the move/delete controls. */
export function MediaCard({
  item,
  disabled,
  updating,
  patchCategories,
  onOpen,
  onCategoryChange,
  onDelete,
}: {
  item: MediaItem
  disabled: boolean
  updating: boolean
  patchCategories: MediaCategory[]
  onOpen: () => void
  onCategoryChange: (category: MediaCategory) => void
  onDelete: () => void
}) {
  const customer = item.ownership === "customer"
  const patchable = isPatchableMediaCategory(item.category)
  const categoryLabel = humaniseCategory(item.category)
  const mediaKind = item.mediaFormat.toLowerCase()

  return (
    <li className="group overflow-hidden rounded-(--nr-radius-card) border border-border/70 bg-background shadow-sm transition-[border-color,box-shadow,transform] duration-(--nr-duration-fast) hover:-translate-y-0.5 hover:border-border hover:shadow-(--nr-shadow-card)">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Preview ${categoryLabel} ${mediaKind}`}
        className="relative block aspect-[4/3] w-full overflow-hidden bg-muted text-left focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none focus-visible:ring-inset"
      >
        {item.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumbnailUrl}
            alt=""
            referrerPolicy="no-referrer"
            loading="lazy"
            className="size-full object-cover transition-transform duration-(--nr-duration-deliberate) group-hover:scale-[1.02]"
          />
        ) : (
          <span
            className="flex size-full items-center justify-center text-muted-foreground"
            aria-hidden
          >
            <ImagesIcon className="size-6" />
          </span>
        )}
        <span
          aria-hidden
          className="absolute inset-0 bg-linear-to-t from-black/70 via-black/0 to-black/20"
        />
        <span className="absolute top-2 left-2">
          <Badge
            variant={customer ? "outline" : "secondary"}
            className="border-white/20 bg-black/55 text-white backdrop-blur-sm"
          >
            {customer ? (
              <UserRoundIcon aria-hidden data-icon="inline-start" />
            ) : (
              <StoreIcon aria-hidden data-icon="inline-start" />
            )}
            {customer ? "Customer" : "Business"}
          </Badge>
        </span>
        <span className="absolute right-2 bottom-2 left-2 flex items-end justify-between gap-2 text-white">
          <span className="min-w-0 truncate text-ui font-semibold">
            {categoryLabel}
          </span>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm">
            <Maximize2Icon aria-hidden className="size-3.5" />
          </span>
        </span>
      </button>

      <div className="min-h-12 border-t border-border/60 p-2.5">
        {customer ? (
          <div className="flex items-center gap-2 text-caption text-muted-foreground">
            <UserRoundIcon aria-hidden className="size-3.5 shrink-0" />
            <span>Shared by a customer</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <label className="min-w-0 flex-1 text-ui">
              <span className="sr-only">Change category</span>
              <Select
                value={patchable ? item.category : null}
                onValueChange={(next) => {
                  if (next == null) return
                  onCategoryChange(next as MediaCategory)
                }}
                disabled={disabled || updating}
              >
                <SelectTrigger
                  className="h-7 w-full px-2"
                  aria-label={`Change category for ${categoryLabel} ${mediaKind}`}
                >
                  <SelectValue placeholder="Move to category…" />
                </SelectTrigger>
                <SelectContent>
                  {patchCategories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {humaniseCategory(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <Button
              variant="destructive"
              size="icon-sm"
              onClick={onDelete}
              disabled={disabled || updating}
              aria-label={`Delete ${categoryLabel} ${mediaKind}`}
            >
              <Trash2Icon aria-hidden />
            </Button>
          </div>
        )}
      </div>
    </li>
  )
}
