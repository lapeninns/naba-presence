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
 * One titled settings block: a Card with a divided header (title, one line of
 * description, optional action) and its content. Replaces the hand-rolled
 * `rounded border bg-surface p-4` sections across settings, setup and privacy.
 */
function SettingsSection({
  id,
  title,
  description,
  action,
  children,
  className,
  headingLevel = "h2",
}: {
  /** Heading id; the section is labelled by it. */
  id: string
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  headingLevel?: "h2" | "h3"
}) {
  return (
    <Card role="region" aria-labelledby={id} className={className}>
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
