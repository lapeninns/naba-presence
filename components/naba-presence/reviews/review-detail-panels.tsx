import { Check } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import type { Review } from "@/lib/naba-presence-data"
import type { ReviewDetailData } from "@/lib/naba-presence-api"

export function VerificationPanel({ review }: { review: Review }) {
  const isWarning = review.verification === "warn"
  const isPending = review.verification === "pending"
  const isFailure = review.verification === "fail"
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Verification</h3>
        <Badge variant={isWarning || isFailure ? "destructive" : "secondary"}>
          {isPending
            ? "Pending"
            : isFailure
              ? "Failed"
              : isWarning
                ? "Review needed"
                : "Passed"}
        </Badge>
      </div>
      {isPending ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Generate or save the draft to run all deterministic checks.
        </p>
      ) : isFailure ? (
        <p className="text-xs leading-relaxed text-destructive">
          This draft is blocked. Edit it and save again to rerun verification.
        </p>
      ) : isWarning ? (
        <p className="text-xs leading-relaxed text-destructive">
          The latest stored verification requires a manager to review this draft
          before publishing.
        </p>
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          The latest stored draft passed the configured verification checks.
        </p>
      )}
    </div>
  )
}

export function ActivityTimeline({
  events: persistedEvents,
  error,
}: {
  events?: ReviewDetailData["timeline"]
  error?: string
}) {
  const events =
    persistedEvents?.slice(0, 8).map((event) => ({
      label: event.action
        .split(".")
        .map((part) => part.replaceAll("_", " "))
        .join(" · "),
      detail: event.createdAt,
      done: true,
    })) ?? []

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Activity</h3>
      {error ? (
        <p className="text-xs leading-relaxed text-destructive">{error}</p>
      ) : events.length ? (
        <ol className="flex flex-col">
          {events.map((event, index) => (
            <li
              key={event.label}
              className="relative flex gap-3 pb-4 last:pb-0"
            >
              {index < events.length - 1 ? (
                <span className="absolute top-5 left-[9px] h-[calc(100%-0.25rem)] w-px bg-border" />
              ) : null}
              <span className="relative mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-primary bg-background text-primary">
                <Check className="size-3" aria-hidden />
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium">{event.label}</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {event.detail}
                </span>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-muted-foreground">
          No activity has been recorded for this review.
        </p>
      )}
    </div>
  )
}
