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
 * `disabled`, `children` (extra content under the description). The radio
 * ring stays visible so the choice is not carried by the tint alone.
 */
function ChoiceCard<Value>({
  title,
  description,
  children,
  className,
  ...props
}: RadioPrimitive.Root.Props<Value> & {
  title: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
}) {
  const id = React.useId()
  return (
    <label
      data-slot="choice-card"
      className={cn(
        "relative flex cursor-pointer gap-3 rounded-(--np-radius-card) border border-line bg-surface p-3.5 transition-[border-color,background-color,box-shadow] duration-(--np-duration-fast) ease-spring-snappy hover:border-line-strong",
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
        className={cn(radioClassName, "mt-0.5 focus-visible:shadow-none")}
        {...props}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
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
    </label>
  )
}

export { ChoiceCard }
