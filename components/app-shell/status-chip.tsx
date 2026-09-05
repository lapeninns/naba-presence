"use client"

import * as React from "react"

import {
  type ConnectionHealth,
  useConnectionHealth,
} from "@/lib/queries/use-connection-health"
import { TONE_CLASSES, type StatusTone } from "@/lib/ui/status-tone"
import { cn } from "@/lib/utils"

/**
 * A toolbar capsule: a grey pill from the fill ladder carrying a vivid dot and
 * a short label. The dot is the only colour — the capsule itself stays grey
 * so the toolbar never turns a status hue — and the label is always in the
 * accessibility tree even when it is hidden below `sm`.
 */
function HealthCapsule({
  tone,
  pulse = false,
  className,
  children,
  ...props
}: React.ComponentProps<"span"> & {
  tone: StatusTone
  /** The dot breathes while the state is still being established. */
  pulse?: boolean
}) {
  return (
    <span
      data-slot="health-capsule"
      data-tone={tone}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-(--np-radius-pill) bg-fill-secondary px-2.5 text-caption font-medium whitespace-nowrap text-ink-muted",
        className
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          TONE_CLASSES[tone].dot,
          pulse && "animate-pulse"
        )}
      />
      {children}
    </span>
  )
}

const CONNECTION_TONE: Record<ConnectionHealth, StatusTone> = {
  connected: "healthy",
  loading: "neutral",
  stale: "attention",
  disconnected: "neutral",
  error: "at-risk",
}

// Always visible: a compact colour dot at every width, with the text label
// promoted from sr-only to visible at `sm` and up. `useConnectionHealth`
// shares its TanStack Query cache entry with the shell's live-region
// announcer (both read `queryKeys.connections`), so this never issues a
// second fetch beyond the one the layout already hydrated.
function StatusChip() {
  const { status, label } = useConnectionHealth()
  return (
    <HealthCapsule tone={CONNECTION_TONE[status]} pulse={status === "loading"}>
      <span className="sr-only sm:not-sr-only">{label}</span>
    </HealthCapsule>
  )
}

export { HealthCapsule, StatusChip }
