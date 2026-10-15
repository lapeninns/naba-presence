"use client"

import { CircleAlertIcon, FileIcon, XIcon } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

const MB = 1024 * 1024

/** A file's size in words a person reads: "840 KB", "3.2 MB". */
export function formatFileSize(bytes: number) {
  return bytes >= MB
    ? `${(bytes / MB).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export type FileCardProgress = Omit<
  React.ComponentProps<typeof Progress>,
  "label"
> & {
  /** The bar's accessible name. Default "Upload progress for {name}". */
  label?: string
}

export type FileCardProps = Omit<
  React.ComponentProps<"li">,
  "children" | "title"
> & {
  /** The file's name. Wraps onto as many lines as it needs; never clipped. */
  name: string
  /** A thumbnail (an object URL or a stored image). */
  previewUrl?: string | null
  /** The thumbnail's text alternative; empty when the name beside it says it. */
  previewAlt?: string
  /**
   * The type glyph drawn when there is no thumbnail. Default: a file glyph,
   * or the alert glyph when the file was refused.
   */
  fallbackIcon?: React.ReactNode
  /** Bytes. Drawn first on the meta line ("840 KB"). */
  size?: number
  /** The state in words ("Ready", "Uploading", "Refused"); after the size. */
  state?: React.ReactNode
  /**
   * Replaces the built size · state line entirely (e.g. the size and a
   * StatusPill). The photos sheet uses it this way.
   */
  meta?: React.ReactNode
  /** A Progress under the name (words first: give it a `status`). */
  progress?: FileCardProgress
  /** Why the file was refused, in words, in the danger ink. */
  refusal?: React.ReactNode
  /** Draws the named remove (×): "Remove {name}". */
  onRemove?: () => void
  /** The remove button's accessible name. Default "Remove {name}". */
  removeLabel?: string
  /** The corner region, for anything other than the remove (×). */
  trailing?: React.ReactNode
  /** Extra lines under the progress and the refusal. */
  children?: React.ReactNode
}

/**
 * One attached file (REFERENCE-BRIEF §4.3 EditorSurface attachments; Notion
 * Mail's "Overview.pdf 77 KB ×"): a card with a 1px line edge and the card
 * radius, holding a thumbnail or a type glyph, the name, a size · state
 * line, then optionally a progress bar and the refusal reason, and a named
 * remove (×) in the corner.
 *
 * Regions are thumbnail / name / `meta` / `trailing` / `children`, and
 * `size`, `state`, `progress`, `refusal` and `onRemove` draw the common
 * contents for it. The photos sheet is its first flow consumer.
 *
 * It is an `li`: put cards in a `ul` (a strip or a grid) named for what they
 * are ("Photos to upload"). Words first: the state and the refusal are text;
 * the bar and the red only reinforce them. The remove is 36px drawn with a
 * 44px touch hit area, and its name says which file it removes.
 */
function FileCard({
  name,
  previewUrl,
  previewAlt = "",
  fallbackIcon,
  size,
  state,
  meta,
  progress,
  refusal,
  onRemove,
  removeLabel,
  trailing,
  children,
  className,
  ...props
}: FileCardProps) {
  const refused = refusal !== undefined && refusal !== null && refusal !== false
  const glyph =
    fallbackIcon ??
    (refused ? (
      <CircleAlertIcon aria-hidden className="size-4 text-danger-ink" />
    ) : (
      <FileIcon aria-hidden className="size-4" />
    ))
  const hasState = state !== undefined && state !== null && state !== false
  const metaLine =
    meta ??
    (size !== undefined || hasState ? (
      <>
        {size !== undefined ? (
          <span className="tabular-nums">{formatFileSize(size)}</span>
        ) : null}
        {size !== undefined && hasState ? <span aria-hidden>·</span> : null}
        {hasState ? <span data-slot="file-card-state">{state}</span> : null}
      </>
    ) : null)
  const corner =
    trailing ??
    (onRemove ? (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={removeLabel ?? `Remove ${name}`}
        onClick={onRemove}
      >
        <XIcon aria-hidden />
      </Button>
    ) : null)
  return (
    <li
      data-slot="file-card"
      data-refused={refused || undefined}
      className={cn(
        "flex min-w-0 items-start gap-3 rounded-(--np-radius-card) border border-line bg-surface p-2.5",
        className
      )}
      {...props}
    >
      <span
        aria-hidden={previewUrl && previewAlt ? undefined : true}
        data-slot="file-card-thumbnail"
        className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-(--np-radius-tag) bg-fill text-ink-muted"
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt={previewAlt}
            className="size-full object-cover"
          />
        ) : (
          glyph
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          data-slot="file-card-name"
          className="text-ui font-medium break-words text-ink"
        >
          {name}
        </span>
        {metaLine ? (
          <span
            data-slot="file-card-meta"
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-muted"
          >
            {metaLine}
          </span>
        ) : null}
        {progress ? (
          <Progress
            {...progress}
            label={progress.label ?? `Upload progress for ${name}`}
          />
        ) : null}
        {refused ? (
          <p
            data-slot="file-card-refusal"
            className="flex items-start gap-1.5 text-caption text-danger-ink"
          >
            <CircleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0" />
            <span className="min-w-0 break-words">{refusal}</span>
          </p>
        ) : null}
        {children}
      </div>
      {corner ? (
        <span
          data-slot="file-card-trailing"
          className="-mt-1 -mr-1 flex shrink-0"
        >
          {corner}
        </span>
      ) : null}
    </li>
  )
}

export { FileCard }
