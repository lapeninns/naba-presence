"use client"

import {
  ClockIcon,
  PauseCircleIcon,
  PowerOffIcon,
  RefreshCwIcon,
} from "lucide-react"
import type * as React from "react"

import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

type PanelVariant =
  "loading" | "empty" | "error" | "paused" | "off" | "collecting"

const COPY: Record<
  Exclude<PanelVariant, "loading">,
  { title: string; description: string }
> = {
  empty: {
    title: "Nothing to show yet",
    description: "There is no data for this window.",
  },
  // A state the screen cannot resolve by waiting: the request already came
  // back, and it said Google has not sent any figures for this window yet.
  // It used to render as `loading` — a skeleton that could only ever stop on
  // a reload, days later.
  collecting: {
    title: "Nothing collected yet",
    description:
      "Google has not sent any figures for this window. They appear here once it does.",
  },
  error: {
    title: "We could not load this report",
    description:
      "The reporting service didn’t answer, so nothing is shown rather than a guess. Nothing was changed.",
  },
  paused: {
    title: "Reporting is paused",
    description: "This report is on hold for now. Please check back soon.",
  },
  off: {
    title: "Not switched on",
    description: "Ask an admin to enable this for your account.",
  },
}

const ICONS: Record<
  Exclude<PanelVariant, "loading" | "error">,
  React.ReactNode
> = {
  empty: <ClockIcon />,
  collecting: <ClockIcon />,
  paused: <PauseCircleIcon />,
  off: <PowerOffIcon />,
}

/**
 * One report's non-figure states (reference `loadingPanel`, `errorPanel`,
 * `emptyPanel`). Loading is a named spinner over the shapes that will
 * arrive; an error is the danger alert with a retry; the rest are the
 * `Empty` pattern, drawn on a bordered card when `framed` (a panel standing
 * on the page) and bare inside a card that already has an edge.
 */
export function ReportingPanel({
  variant,
  title,
  description,
  onRetry,
  framed = false,
  icon,
  action,
}: {
  variant: PanelVariant
  title?: string
  description?: string
  onRetry?: () => void
  /** Draw the empty state on its own bordered card. */
  framed?: boolean
  /** Overrides the empty state's glyph (a lucide icon). */
  icon?: React.ReactNode
  /** A next step under an empty state. */
  action?: React.ReactNode
}) {
  if (variant === "loading") {
    return (
      <div
        aria-busy="true"
        role={title ? "status" : undefined}
        className="flex flex-col gap-3"
      >
        {title ? (
          <p className="flex items-center gap-2 text-ui text-ink-muted">
            <Spinner decorative size="sm" className="shrink-0" />
            {title}
          </p>
        ) : null}
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 rounded-(--np-radius-control)" />
        ))}
      </div>
    )
  }
  if (variant === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>{title ?? COPY.error.title}</AlertTitle>
        <AlertDescription>{description ?? COPY.error.description}</AlertDescription>
        {onRetry ? (
          <AlertActions>
            <Button variant="secondary" size="sm" onClick={onRetry}>
              <RefreshCwIcon aria-hidden strokeWidth={1.75} />
              Try again
            </Button>
          </AlertActions>
        ) : null}
      </Alert>
    )
  }
  const copy = COPY[variant]
  const empty = (
    <Empty
      icon={icon ?? ICONS[variant]}
      title={title ?? copy.title}
      description={description ?? copy.description}
      action={action}
    />
  )
  if (!framed) return empty
  return (
    <div className="rounded-(--np-radius-card) border border-line bg-surface">
      {empty}
    </div>
  )
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
