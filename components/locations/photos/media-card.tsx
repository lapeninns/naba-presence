"use client"

import {
  CheckIcon,
  ImagesIcon,
  Maximize2Icon,
  StarIcon,
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
 * One library tile: a rounded thumbnail with a hairline edge, the ownership
 * badge over the image, and (for merchant media) the move/delete controls in
 * a strip beneath.
 *
 * The on-image scrim and text use the ink pair (`bg-ink/70` under
 * `text-ink-inverse`) rather than literal black and white, so the overlay
 * follows the theme and never introduces a raw colour.
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

  return (
    <li
      data-slot="media-card"
      data-selected={selected || undefined}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-(--np-radius-card) bg-surface transition-[box-shadow,transform] duration-(--np-duration-fast) ease-spring-snappy",
        selected
          ? "[box-shadow:0_0_0_2px_var(--np-accent-vivid)]"
          : "hairline hover:[box-shadow:var(--np-shadow-raised)]"
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Preview ${categoryLabel} ${mediaKind}`}
        className="relative block aspect-[4/3] w-full overflow-hidden bg-fill text-left focus-visible:outline-none focus-visible:[box-shadow:inset_var(--np-focus-halo)]"
      >
        {item.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumbnailUrl}
            alt=""
            referrerPolicy="no-referrer"
            loading="lazy"
            className="size-full object-cover transition-transform duration-(--np-duration-deliberate) ease-spring group-hover:scale-[1.02]"
          />
        ) : (
          <span
            className="flex size-full items-center justify-center text-ink-faint"
            aria-hidden
          >
            <ImagesIcon className="size-6" strokeWidth={1.25} />
          </span>
        )}
        <span
          aria-hidden
          className="absolute inset-0 bg-linear-to-t from-ink/70 via-transparent to-transparent"
        />
        <span className="absolute top-2 left-2">
          <Badge
            variant="secondary"
            className="bg-ink/70 text-ink-inverse"
          >
            {customer ? (
              <UserRoundIcon
                aria-hidden
                strokeWidth={1.75}
                data-icon="inline-start"
              />
            ) : (
              <StoreIcon
                aria-hidden
                strokeWidth={1.75}
                data-icon="inline-start"
              />
            )}
            {customer ? "Customer" : "Business"}
          </Badge>
        </span>
        {selected ? (
          <span
            aria-hidden
            data-slot="media-card-check"
            className="absolute top-2 right-2 flex size-5 items-center justify-center rounded-(--np-radius-pill) bg-primary text-primary-foreground shadow-(--np-shadow-raised)"
          >
            <CheckIcon className="size-3" strokeWidth={2.5} />
          </span>
        ) : null}
        <span className="absolute right-2 bottom-2 left-2 flex items-end justify-between gap-2 text-ink-inverse">
          <span className="min-w-0 truncate text-ui font-semibold">
            {categoryLabel}
          </span>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-(--np-radius-pill) bg-ink/70">
            <Maximize2Icon
              aria-hidden
              className="size-3.5"
              strokeWidth={1.75}
            />
          </span>
        </span>
      </button>

      <div className="flex min-h-12 items-center border-t border-line-subtle p-2.5">
        {customer ? (
          <div className="flex items-center gap-2 text-caption text-ink-muted">
            <UserRoundIcon
              aria-hidden
              className="size-3.5 shrink-0"
              strokeWidth={1.75}
            />
            <span>Shared by a customer</span>
          </div>
        ) : (
          <div className="flex w-full items-center gap-2">
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
                  className="w-full"
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
            {item.category === "LOGO" ? (
              <Badge variant="tinted">Logo</Badge>
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="secondary"
                      size="icon"
                      onClick={() => onCategoryChange("LOGO")}
                      disabled={disabled || updating}
                      // Moving a photo to LOGO through the category dropdown
                      // works, but nobody looking for "make this our logo"
                      // thinks to open a list called "Move to category".
                      aria-label={`Use this ${mediaKind} as the logo`}
                    />
                  }
                >
                  <StarIcon aria-hidden strokeWidth={1.75} />
                </TooltipTrigger>
                <TooltipContent>Use as logo</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={onDelete}
                    disabled={disabled || updating}
                    aria-label={`Delete ${categoryLabel} ${mediaKind}`}
                  />
                }
              >
                <Trash2Icon aria-hidden strokeWidth={1.75} />
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
    </li>
  )
}
