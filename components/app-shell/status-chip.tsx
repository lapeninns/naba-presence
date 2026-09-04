"use client"

import { Badge } from "@/components/ui/badge"
import {
  type ConnectionHealth,
  useConnectionHealth,
} from "@/lib/queries/use-connection-health"
import { cn } from "@/lib/utils"

const DOT_CLASS: Record<ConnectionHealth, string> = {
  connected: "bg-success",
  loading: "bg-muted-foreground/50",
  stale: "bg-warning",
  disconnected: "bg-muted-foreground",
  error: "bg-destructive",
}

// Always visible: a compact colour dot at every width, with the text label
// promoted from sr-only to visible at `sm` and up. `useConnectionHealth`
// shares its TanStack Query cache entry with the shell's live-region
// announcer (both read `queryKeys.connections`), so this never issues a
// second fetch beyond the one the layout already hydrated.
function StatusChip() {
  const { status, label } = useConnectionHealth()
  return (
    <Badge
      variant="secondary"
      className="gap-1.5 rounded-(--np-radius-pill) px-2.5 py-1 text-ui font-normal text-muted-foreground"
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          DOT_CLASS[status],
          status === "loading" && "animate-pulse"
        )}
      />
      <span className="sr-only sm:not-sr-only">{label}</span>
    </Badge>
  )
}

export { StatusChip }
