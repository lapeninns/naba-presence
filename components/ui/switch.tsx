"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Reference `.switch`: a 36×20 track in the control-edge grey that turns the
 * accent solid when on, and a 16px surface thumb with the raised shadow that
 * slides 16px. `lg` is the 51×31 touch size. A transparent box around the
 * root gives the default size a 44px-tall target on a phone and 28px at the
 * desk (the height follows `--np-touch`, so it needs no pointer patch).
 * Use only for a truly boolean value; if "not set" is a real state, use
 * `TriState` (components/ui/tri-state.tsx) instead.
 */
const switchVariants = cva(
  cn(
    "group/switch relative inline-flex shrink-0 cursor-pointer items-center rounded-(--np-radius-pill) bg-line-strong p-0.5 focus-halo select-none",
    "before:absolute before:-inset-x-1 before:inset-y-[calc((100%-var(--np-touch))/2)] before:content-[''] desk:before:-inset-y-1",
    "transition-[background-color] duration-(--np-duration-fast) ease-spring-snappy",
    "data-checked:bg-primary",
    "data-disabled:cursor-not-allowed data-disabled:opacity-50"
  ),
  {
    variants: {
      size: {
        default: "h-5 w-9",
        lg: "h-[31px] w-[51px]",
      },
    },
    defaultVariants: { size: "default" },
  }
)

const thumbVariants = cva(
  cn(
    "block rounded-(--np-radius-pill) bg-surface shadow-np-raised",
    "transition-transform duration-(--np-duration-fast) ease-spring"
  ),
  {
    variants: {
      size: {
        default: "size-4 data-checked:translate-x-4",
        lg: "size-[27px] data-checked:translate-x-[20px]",
      },
    },
    defaultVariants: { size: "default" },
  }
)

export type SwitchProps = SwitchPrimitive.Root.Props &
  VariantProps<typeof switchVariants> & {
    /**
     * The setting in words. Makes the whole row a native `<label>` — the
     * words are the tap target and the accessible name — with the switch at
     * the trailing edge, as a settings list reads on a phone.
     */
    label?: React.ReactNode
    /** One caption line under the label, wired as the switch's description. */
    description?: React.ReactNode
    /** Classes for the row `<label>` (only with `label`). */
    labelClassName?: string
  }

/**
 * Without `label`, name the switch with `aria-label` / `aria-labelledby` as
 * before. With it, the row replaces the hand-built `SwitchRow`s that pointed
 * `aria-labelledby` at a span and left the hint unannounced: the row is at
 * least 44px tall on a phone, tapping the words toggles, and the description
 * is read after the name. A caller's own `aria-describedby` is kept and
 * read after the description.
 */
function Switch({
  className,
  size,
  label,
  description,
  labelClassName,
  ...props
}: SwitchProps) {
  const id = React.useId()
  const hasLabel = label !== undefined && label !== null
  const describedBy =
    [description ? `${id}-desc` : null, props["aria-describedby"] ?? null]
      .filter(Boolean)
      .join(" ") || undefined

  const control = (
    <SwitchPrimitive.Root
      data-slot="switch"
      // The root is a `span role="switch"`; a wrapping <label> does not name
      // it, so point it at the words explicitly.
      aria-labelledby={hasLabel ? `${id}-label` : undefined}
      className={cn(switchVariants({ size }), className)}
      {...props}
      aria-describedby={describedBy}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={thumbVariants({ size })}
      />
    </SwitchPrimitive.Root>
  )

  if (!hasLabel) return control

  return (
    <label
      data-slot="switch-label"
      className={cn(
        "flex min-h-(--np-touch) cursor-pointer items-center justify-between gap-4 py-2 text-body text-ink select-none",
        "desk:min-h-8 desk:py-1",
        "has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:text-ink-muted",
        // The row is the target; the switch's own halo would only reach into
        // the rows around it.
        "[&>[data-slot=switch]]:before:hidden",
        labelClassName
      )}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span id={`${id}-label`}>{label}</span>
        {description ? (
          <span id={`${id}-desc`} className="text-caption text-ink-muted">
            {description}
          </span>
        ) : null}
      </span>
      {control}
    </label>
  )
}

export { Switch, switchVariants }
