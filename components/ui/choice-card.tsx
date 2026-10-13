"use client"

import { Radio as RadioPrimitive } from "@base-ui/react/radio"
import * as React from "react"

import { radioClassName } from "@/components/ui/radio-group"
import { cn } from "@/lib/utils"

/**
 * A radio as a tile (reference `.choice`): a white card with a hairline
 * edge; selected, the edge and an inset ring turn accent on the accent tint.
 *
 * Use inside `RadioGroup` (arrow keys move between cards). Props: `value`,
 * `title` (the option in words), `description` (one caption line),
 * `disabled`, `children` (extra content under the description), `aside`
 * (a trailing slot: a price, a count, a badge). The radio ring stays visible
 * so the choice is not carried by the tint alone.
 *
 * Content in `children` is part of the card's label, so keep it to words and
 * figures; a link or input inside a `<label>` would select the card when
 * used. For an option that reveals its own follow-up control once chosen,
 * put that control AFTER the card (render it when the value matches).
 *
 * Disabled fades the card once; the ring inside does not fade again.
 */
function ChoiceCard<Value>({
  title,
  description,
  children,
  aside,
  className,
  ...props
}: RadioPrimitive.Root.Props<Value> & {
  title: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  aside?: React.ReactNode
}) {
  const id = React.useId()
  return (
    <label
      data-slot="choice-card"
      className={cn(
        "relative flex min-h-(--np-touch) cursor-pointer gap-3 rounded-(--np-radius-card) border border-line bg-surface p-3.5 transition-[border-color,background-color,box-shadow] duration-(--np-duration-fast) ease-spring-snappy hover:border-line-strong",
        "has-data-checked:border-primary has-data-checked:bg-accent-tint has-data-checked:shadow-[inset_0_0_0_1px_var(--np-accent)]",
        "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-(--np-focus-ring)",
        "has-data-disabled:cursor-not-allowed has-data-disabled:opacity-55",
        className
      )}
    >
      <RadioPrimitive.Root
        data-slot="choice-card-radio"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-desc` : undefined}
        className={cn(
          radioClassName,
          "mt-(--np-selection-offset) focus-visible:shadow-none data-disabled:opacity-100"
        )}
        {...props}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span id={`${id}-title`} className="text-body font-semibold text-ink">
          {title}
        </span>
        {description ? (
          <span id={`${id}-desc`} className="text-caption text-ink-muted">
            {description}
          </span>
        ) : null}
        {children}
      </span>
      {aside ? (
        <span
          data-slot="choice-card-aside"
          className="ml-auto shrink-0 self-start text-ui text-ink-secondary"
        >
          {aside}
        </span>
      ) : null}
    </label>
  )
}

export { ChoiceCard }
