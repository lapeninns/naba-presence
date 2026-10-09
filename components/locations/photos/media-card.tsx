"use client"

import { CheckIcon, ImagesIcon, StarIcon, Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { MediaCategory, MediaItem } from "@/lib/api/location-media"
import {
  humaniseCategory,
  isPatchableMediaCategory,
} from "@/lib/locations/media-labels"
import { cn } from "@/lib/utils"

/**
 * A label drawn on the photo (reference `.media-label .pill.plain`): the
 * surface colour under ink, so it reads on any image and follows the theme.
 */
export function MediaLabel({
  children,
  tone = "plain",
}: {
  children: React.ReactNode
  tone?: "plain" | "accent"
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center rounded-(--np-radius-tag) px-2 text-[11.5px] leading-none font-semibold shadow-np-raised",
        tone === "accent"
          ? "bg-accent-tint text-accent-ink"
          : "bg-surface text-ink"
      )}
    >
      {children}
    </span>
  )
}

/**
 * One library tile (reference `button.media-tile`): the photo at 4:3 with
 * its labels on the image, opening the photo's details. Business photos
 * carry their controls in a strip beneath, always visible so nothing is
 * hover-only on a touch screen; customer photos say whose they are instead,
 * because Google never lets a business move or delete them.
 *
 * `selected` is presentational: an accent ring plus a check badge for a
 * grid that offers multi-select. The grid does not select today; the prop
 * is here so the look is decided once.
 */
export function MediaCard({
  item,
  disabled,
  updating,
  patchCategories,
  selected = false,
  onOpen,
  onCategoryChange,
  onDelete,
}: {
  item: MediaItem
  disabled: boolean
  updating: boolean
  patchCategories: MediaCategory[]
  /** Draws the accent ring and check badge of a selected tile. */
  selected?: boolean
  onOpen: () => void
  onCategoryChange: (category: MediaCategory) => void
  onDelete: () => void
}) {
  const customer = item.ownership === "customer"
  const patchable = isPatchableMediaCategory(item.category)
  const categoryLabel = humaniseCategory(item.category)
  const mediaKind = item.mediaFormat.toLowerCase()
  const isLogo = item.category === "LOGO"

  return (
    <li
      data-slot="media-card"
      data-selected={selected || undefined}
      className={cn(
        "@container/card flex min-w-0 flex-col overflow-hidden rounded-lg border bg-surface",
        selected ? "border-primary ring-2 ring-primary" : "border-line"
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Preview ${categoryLabel} ${mediaKind}`}
        className="group/tile relative block aspect-[4/3] w-full cursor-zoom-in overflow-hidden bg-fill text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {item.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumbnailUrl}
            alt=""
            referrerPolicy="no-referrer"
            loading="lazy"
            decoding="async"
            className="size-full object-cover transition-transform duration-(--np-duration-standard) ease-spring group-hover/tile:scale-[1.03] motion-reduce:transition-none"
          />
        ) : (
          <span
            className="flex size-full items-center justify-center text-ink-muted"
            aria-hidden
          >
            <ImagesIcon className="size-6" strokeWidth={1.5} />
          </span>
        )}
        {selected ? (
          <span
            aria-hidden
            data-slot="media-card-check"
            className="absolute top-2 right-2 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-np-raised"
          >
            <CheckIcon className="size-3" strokeWidth={2.5} />
          </span>
        ) : null}
        <span
          aria-hidden
          className="absolute right-2 bottom-2 left-2 flex flex-wrap gap-1"
        >
          {isLogo ? <MediaLabel tone="accent">Logo</MediaLabel> : null}
          {isLogo ? null : <MediaLabel>{categoryLabel}</MediaLabel>}
          {customer ? <MediaLabel>Customer</MediaLabel> : null}
        </span>
      </button>

      <div className="flex min-h-12 flex-wrap items-center gap-2 border-t border-line p-2">
        {customer ? (
          <p className="px-1 text-caption text-ink-muted">
            Shared by a customer
          </p>
        ) : (
          <>
            {/* A span, not a label: the Select's trigger is a `button`,
                which label-wrapping cannot name. The trigger's own
                aria-label already says which photo it moves. */}
            <span className="min-w-0 basis-full @[15rem]/card:flex-1 @[15rem]/card:basis-0">
              <Select
                value={patchable ? item.category : null}
                onValueChange={(next) => {
                  if (next == null) return
                  onCategoryChange(next as MediaCategory)
                }}
                disabled={disabled || updating}
              >
                <SelectTrigger
                  className="w-full min-w-0"
                  aria-label={`Change category for ${categoryLabel} ${mediaKind}`}
                >
                  <SelectValue placeholder="Move to category…">
                    {(value: string | null) =>
                      value ? humaniseCategory(value) : "Move to category…"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {patchCategories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {humaniseCategory(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </span>
            <span className="ml-auto flex items-center gap-1">
            {isLogo ? null : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onCategoryChange("LOGO")}
                      disabled={disabled || updating}
                      // Moving a photo to LOGO through the category list
                      // works, but nobody looking for "make this our logo"
                      // thinks to open a list called "Move to category".
                      aria-label={`Use this ${mediaKind} as the logo`}
                    />
                  }
                >
                  <StarIcon aria-hidden />
                </TooltipTrigger>
                <TooltipContent>Use as logo</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-danger-ink hover:not-data-disabled:bg-danger-tint"
                    onClick={onDelete}
                    disabled={disabled || updating}
                    aria-label={`Delete ${categoryLabel} ${mediaKind}`}
                  />
                }
              >
                <Trash2Icon aria-hidden />
              </TooltipTrigger>
              <TooltipContent>Delete from Google</TooltipContent>
            </Tooltip>
            </span>
          </>
        )}
      </div>
    </li>
  )
}
