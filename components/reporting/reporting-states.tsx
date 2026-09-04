"use client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

type PanelVariant = "loading" | "empty" | "error" | "paused" | "off" | "collecting"

const COPY: Record<Exclude<PanelVariant, "loading">, { title: string; description: string }> = {
  empty: { title: "Nothing to show yet", description: "There is no data for this window." },
  // A state the screen cannot resolve by waiting: the request already came
  // back, and it said Google has not sent any figures for this window yet.
  // It used to render as `loading` — a skeleton that could only ever stop on
  // a reload, days later.
  collecting: {
    title: "Nothing collected yet",
    description:
      "Google has not sent any figures for this window. They appear here once it does.",
  },
  error: { title: "We could not load this", description: "Check your connection, then try again." },
  paused: { title: "Reporting is paused", description: "This report is on hold for now. Please check back soon." },
  off: { title: "Not switched on", description: "Ask an admin to enable this for your account." },
}

export function ReportingPanel({
  variant,
  title,
  description,
  onRetry,
}: {
  variant: PanelVariant
  title?: string
  description?: string
  onRetry?: () => void
}) {
  if (variant === "loading") {
    return (
      <div
        aria-busy="true"
        role={title ? "status" : undefined}
        className="flex flex-col gap-2"
      >
        {title ? (
          <p className="flex items-center gap-2 text-ui text-ink-muted">
            <Spinner decorative className="size-3.5 shrink-0" />
            {title}
          </p>
        ) : null}
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 rounded-(--np-radius-card)" />
        ))}
      </div>
    )
  }
  if (variant === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>{title ?? COPY.error.title}</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-2">
          <span>{description ?? COPY.error.description}</span>
          {onRetry ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
        </AlertDescription>
      </Alert>
    )
  }
  const copy = COPY[variant]
  return <Empty title={title ?? copy.title} description={description ?? copy.description} />
}

// Honest-null helper: a missing metric is "—" flagged isNull (so tables can
// style it muted and sort it last), never coerced to 0.
export function nullableCell(
  value: number | null,
  render: (v: number) => string
): { text: string; isNull: boolean } {
  if (value === null) return { text: "—", isNull: true }
  return { text: render(value), isNull: false }
}
