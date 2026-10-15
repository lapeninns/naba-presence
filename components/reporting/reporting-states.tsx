"use client"

import { ClockIcon, PauseCircleIcon, PowerOffIcon } from "lucide-react"
import type * as React from "react"

import { Card } from "@/components/ui/card"
import { Empty } from "@/components/ui/empty"
import { QueryError, QueryPending } from "@/components/ui/query-states"
import { describeActionError } from "@/lib/errors/action-errors"

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
 * `emptyPanel`), drawn with the shared state primitives: loading is
 * `QueryPending` (a named status over the rows that will arrive), an error
 * is `QueryError` (the `Empty` error state, announced, with a retry), and
 * the rest are `Empty`, drawn on a bordered card when `framed` (a panel
 * standing on the page) and bare inside a card that already has an edge.
 */
export function ReportingPanel({
  variant,
  title,
  description,
  onRetry,
  cause,
  framed = false,
  icon,
  action,
  titleAs = "p",
  placement = "inline",
  illustration,
}: {
  variant: PanelVariant
  title?: string
  description?: string
  onRetry?: () => void
  /**
   * The error behind an `error` panel. Its real reason (signed out, no
   * permission, the network, a timeout) replaces the generic sentence, the
   * same wording every other surface gives through `describeActionError`.
   */
  cause?: unknown
  /** Draw the empty state on its own bordered card. */
  framed?: boolean
  /** Overrides the empty state's glyph (a lucide icon). */
  icon?: React.ReactNode
  /** A next step under an empty state. */
  action?: React.ReactNode
  /**
   * The empty state's title as a heading, one level under the section it
   * stands in for: a framed panel that is the whole of a tab or section is
   * a heading (h3 under the tab's h2, h2 directly under the page); a small
   * note inside a card stays a `p`.
   */
  titleAs?: "p" | "h2" | "h3"
  /**
   * `page` only when the panel IS what the page shows under its title (a
   * scope that resolves to nothing); every in-tab or in-section state is
   * `inline`.
   */
  placement?: "inline" | "page"
  /**
   * A line drawing in place of the glyph (`<EmptyIllustration … />`), only
   * where the drawing names the real reason (a filter or lookup that found
   * nothing draws "search").
   */
  illustration?: React.ReactNode
}) {
  if (variant === "loading") {
    // The shared pending state: a named, announced wait when a caller says
    // what is loading, and the row placeholders either way.
    return <QueryPending label={title} />
  }
  if (variant === "error") {
    // The shared failed-load state: `<Empty variant="error">` announced as
    // an alert, with a 44px "Try again" when there is a retry. Always on its
    // own card, as the danger alert it replaces was: a failed report stands
    // in for content, so it is never a bare line on the page.
    return (
      <QueryError
        framed
        title={title ?? COPY.error.title}
        description={
          description ??
          (cause === undefined
            ? COPY.error.description
            : `${describeActionError(cause)} Nothing was changed.`)
        }
        onRetry={onRetry}
      />
    )
  }
  const copy = COPY[variant]
  const empty = (
    <Empty
      icon={icon ?? ICONS[variant]}
      titleAs={titleAs}
      title={title ?? copy.title}
      description={description ?? copy.description}
      action={action}
      placement={placement}
      illustration={illustration}
    />
  )
  if (!framed) return empty
  return <Card flush>{empty}</Card>
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
