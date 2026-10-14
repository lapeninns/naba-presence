"use client"

import { CircleAlertIcon } from "lucide-react"

import { cn } from "@/lib/utils"

const MB = 1024 * 1024

/** A file's size in words a person reads: "840 KB", "3.2 MB". */
export function formatUploadSize(bytes: number) {
  return bytes >= MB
    ? `${(bytes / MB).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * One file waiting to go to Google, drawn as Notion Mail's attachment card
 * ("Overview.pdf 77 KB ×"): a small thumbnail, the name, then the size and
 * the state in words, with an optional remove at the top-right corner.
 *
 * Regions are fixed so the add dialog and the upload review show the same
 * object: `thumbnail` / name / `meta` / `trailing` / `children` (progress
 * and the refusal reason, under the name).
 */
export function UploadFileCard({
  name,
  previewUrl,
  previewAlt = "",
  fallbackIcon,
  meta,
  trailing,
  children,
  className,
}: {
  name: string
  previewUrl?: string | null
  /** The thumbnail's text alternative; empty when the name beside it says it. */
  previewAlt?: string
  /** Drawn when there is no thumbnail; the alert glyph by default. */
  fallbackIcon?: React.ReactNode
  /** The size and the state, in words, under the name. */
  meta?: React.ReactNode
  /** The corner action, e.g. the remove button. */
  trailing?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <li
      data-slot="upload-file-card"
      className={cn(
        "flex min-w-0 items-start gap-3 rounded-(--np-radius-field) border border-line bg-surface p-2.5",
        className
      )}
    >
      <span
        aria-hidden={previewAlt ? undefined : true}
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
          (fallbackIcon ?? <CircleAlertIcon aria-hidden className="size-4" />)
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-ui font-medium break-words text-ink">{name}</span>
        {meta ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-muted">
            {meta}
          </span>
        ) : null}
        {children}
      </div>
      {trailing ? (
        <span className="-mt-1 -mr-1 flex shrink-0">{trailing}</span>
      ) : null}
    </li>
  )
}
