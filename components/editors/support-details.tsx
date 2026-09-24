"use client"

import { ChevronRightIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Machine reasons (a reason code, a request id) folded behind "Details for
 * support". The sentence beside it is what the operator acts on; these are
 * for quoting to whoever supports them, so they stay one click away instead
 * of sitting in the sentence as jargon.
 */
function SupportDetails({
  items,
  className,
}: {
  items: ReadonlyArray<string | null | undefined>
  className?: string
}) {
  const shown = items.filter((item): item is string => Boolean(item))
  if (shown.length === 0) return null
  return (
    <details
      data-slot="support-details"
      className={cn("group/support text-caption text-ink-muted", className)}
    >
      <summary className="inline-flex min-h-6 cursor-pointer list-none items-center gap-1 rounded-sm focus-halo pointer-coarse:min-h-(--np-touch) [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          aria-hidden
          className="size-3.5 transition-transform group-open/support:rotate-90 motion-reduce:transition-none"
        />
        Details for support
      </summary>
      <span className="mt-1 flex flex-wrap gap-1.5">
        {shown.map((item) => (
          <code
            key={item}
            className="inline-block max-w-full rounded-(--np-radius-tag) border border-line bg-surface px-1.5 font-mono text-caption break-all text-ink-secondary select-all"
          >
            {item}
          </code>
        ))}
      </span>
    </details>
  )
}

export { SupportDetails }
