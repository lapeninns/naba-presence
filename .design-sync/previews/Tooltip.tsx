import {
  Badge,
  Button,
  Kbd,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "NabaReview"
import { InfoIcon, RefreshCwIcon } from "lucide-react"

// A tooltip only appears on hover/focus, which a static capture cannot
// trigger — every cell therefore drives `open` directly (controlled, so
// nothing can dismiss it) and reserves room around the trigger so the
// portaled bubble has somewhere to land.

export function EscalatedStatus() {
  return (
    <TooltipProvider>
      <div className="flex min-h-40 items-center justify-center p-8">
        <Tooltip open>
          <TooltipTrigger render={<Button variant="outline" />}>
            Escalated
          </TooltipTrigger>
          <TooltipContent side="top">
            1★ or 2★ and still unanswered after 48 hours — routed to the duty manager.
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )
}

export function MetricExplainer() {
  return (
    <TooltipProvider>
      {/* Left-aligned on purpose: a side="right" bubble anchored to a centred
          trigger runs past the right edge of a grid cell and flips back over
          its own content. */}
      <div className="flex min-h-40 items-center justify-start p-8">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Reply rate</span>
          <span className="font-mono text-sm text-foreground">88%</span>
          <Tooltip open>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" />}>
              <InfoIcon />
            </TooltipTrigger>
            <TooltipContent side="right">Answered within 7 days</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  )
}

export function SyncDetail() {
  return (
    <TooltipProvider>
      <div className="flex min-h-40 items-center justify-center p-8">
        <Tooltip open>
          <TooltipTrigger render={<Badge variant="secondary" />}>
            <RefreshCwIcon data-icon="inline-start" />
            Synced 4m ago
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Last pulled from Google Business Profile at 09:12 — Central, Riverside, Airport.
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )
}

export function WithShortcut() {
  return (
    <TooltipProvider>
      <div className="flex min-h-40 items-center justify-center p-8">
        <Tooltip open>
          <TooltipTrigger render={<Button />}>Post reply</TooltipTrigger>
          <TooltipContent side="top">
            Send to Google
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )
}
