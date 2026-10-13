import * as React from "react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

/**
 * One titled settings block. Two looks, one API:
 * - `card` (default): a Card with a divided header (title, one line of
 *   description, optional action) and its content. Setup uses this.
 * - `group`: the Drop 1 SettingsGroup look. A quiet sentence-case label in
 *   `ink-muted` sits above the content; on a phone (and any touch screen)
 *   the content lies flat on the canvas, and at the desk it sits in a
 *   bordered card.
 * Either way the block is a region labelled by its heading.
 */
function SettingsSection({
  id,
  title,
  description,
  action,
  children,
  className,
  contentClassName,
  headingLevel = "h2",
  variant = "card",
  "data-slot": slot,
}: {
  /** Heading id; the section is labelled by it. */
  id: string
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  /** Extra classes for the content box (`group` only). */
  contentClassName?: string
  headingLevel?: "h2" | "h3"
  variant?: "card" | "group"
  /** Overrides the block's `data-slot` (tests and pages find it by this). */
  "data-slot"?: string
}) {
  if (variant === "group") {
    // Drop 1's SettingsGroup look (components/ui/settings-row.tsx): its
    // label row and its desk-only card. That primitive holds a list of
    // rows; a section holds forms and facts, so it keeps its own box.
    const Heading = headingLevel
    return (
      <section
        aria-labelledby={id}
        data-slot={slot ?? "settings-section"}
        data-variant="group"
        className={cn("flex min-w-0 flex-col gap-1", className)}
      >
        <div className="flex min-h-(--np-touch) flex-wrap items-center justify-between gap-x-3 gap-y-1 desk:min-h-8">
          <div className="flex min-w-0 flex-col gap-0.5">
            <Heading
              id={id}
              data-slot="settings-group-label"
              className="text-ui font-medium text-ink-muted"
            >
              {title}
            </Heading>
            {description ? (
              <p className="text-caption text-ink-muted">{description}</p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
        <div
          className={cn(
            "@container flex min-w-0 flex-col gap-3 desk:rounded-(--np-radius-card) desk:border desk:border-line desk:bg-surface desk:p-(--np-card-pad)",
            contentClassName
          )}
        >
          {children}
        </div>
      </section>
    )
  }
  return (
    <Card
      role="region"
      aria-labelledby={id}
      // Only when given: otherwise the Card keeps its own `card` slot.
      {...(slot ? { "data-slot": slot } : {})}
      className={className}
    >
      <CardHeader divided>
        <CardTitle as={headingLevel} id={id}>
          {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {action ? (
          <div className="col-start-1 row-start-3 mt-2 sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:mt-0 sm:self-start sm:justify-self-end">
            {action}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  )
}

/**
 * A description list of label/value facts. On a phone each fact stacks
 * (label above value) so long values never collide with their label; from
 * `sm` the label and value share a row. `columns` spreads facts across a grid
 * on wide containers.
 */
function SettingsFacts({
  facts,
  columns = 1,
  numeric = false,
  className,
}: {
  facts: ReadonlyArray<
    readonly [label: React.ReactNode, value: React.ReactNode] | null | false
  >
  columns?: 1 | 2 | 3
  /** Set values in tabular mono figures. */
  numeric?: boolean
  className?: string
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-1 gap-x-6",
        columns >= 2 && "sm:grid-cols-2",
        columns === 3 && "lg:grid-cols-3",
        className
      )}
    >
      {facts.map((fact, index) =>
        fact ? (
          <div
            key={index}
            className="flex min-w-0 flex-col gap-0.5 border-b border-line py-2 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
          >
            <dt className="text-caption text-ink-secondary sm:text-ui">
              {fact[0]}
            </dt>
            <dd
              className={cn(
                "min-w-0 text-ui break-words text-ink sm:text-right",
                numeric && "font-mono tabular-nums"
              )}
            >
              {fact[1]}
            </dd>
          </div>
        ) : null
      )}
    </dl>
  )
}

export { SettingsSection, SettingsFacts }
