"use client"

import { Fieldset as FieldsetPrimitive } from "@base-ui/react/fieldset"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

import { cn } from "@/lib/utils"

type FieldsetContextValue = {
  descriptionId: string
  registerDescription: (present: boolean) => void
}

const FieldsetContext = React.createContext<FieldsetContextValue | null>(null)

/**
 * A group of related controls under one name: the days of an hours editor,
 * a checkbox list, a pair of address lines. Built on Base UI Fieldset, so the
 * legend names the group (`aria-labelledby`) and `disabled` reaches every
 * Base UI control inside it.
 *
 * Replaces the hand-rolled `<fieldset>` + `<legend className=…>` pairs (30
 * of them, with 12 different legend recipes): the browser's fieldset border,
 * padding and `min-width: min-content` are reset here once, which is the
 * part every copy got slightly differently wrong — the last one is what let
 * a long row push a phone layout sideways.
 *
 * `FieldsetDescription` is announced with the group name, the same way
 * `FieldDescription` is for a single field. Use `FieldGroup` for the vertical
 * rhythm between the Fields inside.
 */
function Fieldset({
  className,
  children,
  ...props
}: FieldsetPrimitive.Root.Props) {
  const descriptionId = React.useId()
  const [hasDescription, setHasDescription] = React.useState(false)
  const context = React.useMemo(
    () => ({ descriptionId, registerDescription: setHasDescription }),
    [descriptionId]
  )
  return (
    <FieldsetContext.Provider value={context}>
      <FieldsetPrimitive.Root
        data-slot="fieldset"
        aria-describedby={hasDescription ? descriptionId : undefined}
        className={cn(
          "m-0 flex min-w-0 flex-col gap-3 border-0 p-0",
          "data-disabled:text-ink-muted",
          className
        )}
        {...props}
      >
        {children}
      </FieldsetPrimitive.Root>
    </FieldsetContext.Provider>
  )
}

/**
 * The legend, in one of the three looks the product actually uses:
 *
 *   - `label` (default) — reads as a field label (FieldLabel's type), for a
 *     group that is one question: "Opening days", "Notify me about".
 *   - `muted` — secondary ink, for a sub-group under a heading that already
 *     says what the section is.
 *   - `section` — the card-title size, for a fieldset that IS the section.
 *
 * `srOnly` keeps the name for assistive tech when a visible heading nearby
 * already says it (the group still needs a name of its own).
 */
const legendVariants = cva("p-0", {
  variants: {
    variant: {
      label: "text-ui leading-5 font-semibold text-ink",
      muted: "text-ui text-ink-secondary",
      section: "text-title font-semibold text-ink",
    },
  },
  defaultVariants: { variant: "label" },
})

function FieldsetLegend({
  className,
  variant,
  srOnly = false,
  ...props
}: FieldsetPrimitive.Legend.Props &
  VariantProps<typeof legendVariants> & { srOnly?: boolean }) {
  return (
    <FieldsetPrimitive.Legend
      data-slot="fieldset-legend"
      className={cn(
        srOnly ? "sr-only" : legendVariants({ variant }),
        className
      )}
      {...props}
    />
  )
}

function FieldsetDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const fieldset = React.useContext(FieldsetContext)
  const register = fieldset?.registerDescription

  // Same reasoning as FieldDescription: only point aria-describedby at the
  // id once the element is really in the DOM.
  React.useLayoutEffect(() => {
    register?.(true)
    return () => register?.(false)
  }, [register])

  return (
    <div
      id={fieldset?.descriptionId}
      data-slot="fieldset-description"
      className={cn("-mt-1.5 text-caption text-ink-muted", className)}
      {...props}
    />
  )
}

/**
 * The vertical stack of Fields in a form or fieldset: 16px apart on a phone
 * where each field is a 44px control plus label and hint, 14px at the desk.
 * One rhythm instead of each form choosing its own `gap-*`.
 */
function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-group"
      className={cn("flex min-w-0 flex-col gap-4 desk:gap-3.5", className)}
      {...props}
    />
  )
}

export {
  FieldGroup,
  Fieldset,
  FieldsetDescription,
  FieldsetLegend,
  legendVariants,
}
