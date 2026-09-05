"use client"

import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useState,
} from "react"

import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

type FieldContextValue = {
  id: string
  errorId: string
  descriptionId: string
  invalid: boolean
  error?: string
  hasDescription: boolean
  registerDescription: (present: boolean) => void
}

const FieldContext = createContext<FieldContextValue | null>(null)

export function useFieldContext() {
  return useContext(FieldContext)
}

/**
 * A labelled form control: label above in the UI role at medium weight, the
 * control, then a caption-sized description or error beneath. The Field
 * carries `data-invalid` when it has an error so a control inside it can swap
 * its edge to the danger line without knowing about the context.
 */
function Field({
  error,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { error?: string }) {
  const id = useId()
  const [hasDescription, setHasDescription] = useState(false)
  return (
    <FieldContext.Provider
      value={{
        id,
        errorId: `${id}-error`,
        descriptionId: `${id}-description`,
        invalid: Boolean(error),
        error,
        hasDescription,
        registerDescription: setHasDescription,
      }}
    >
      <div
        data-slot="field"
        data-invalid={error ? "" : undefined}
        className={cn("flex flex-col gap-1.5", className)}
        {...props}
      >
        {children}
      </div>
    </FieldContext.Provider>
  )
}

function FieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>) {
  const field = useFieldContext()
  return (
    <Label
      htmlFor={field?.id}
      className={cn("text-ui font-medium text-ink", className)}
      {...props}
    />
  )
}

function FieldDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const field = useFieldContext()
  const registerDescription = field?.registerDescription

  // Registers presence with the Field, not just renders the element -
  // `fieldControlProps` needs to know a FieldDescription actually mounted
  // before it can safely point `aria-describedby` at `descriptionId`.
  // Layout effect (not a plain effect) so the id is attached before the
  // browser paints, and the register(false) cleanup keeps unmount in sync.
  // Runs client-only during SSR, which is fine here: the server-rendered
  // and pre-hydration client markup both omit the id, so there's no
  // hydration mismatch - it simply attaches post-mount.
  useLayoutEffect(() => {
    registerDescription?.(true)
    return () => registerDescription?.(false)
  }, [registerDescription])

  // A <div>, not a <p>: callers (e.g. PasswordField) nest block content
  // like PasswordRequirements' <ul> inside this, and <ul> inside <p> is
  // invalid HTML that trips React's hydration-mismatch warning. aria-*
  // wiring doesn't care about tag semantics, so this is a plain swap.
  return (
    <div
      id={field?.descriptionId}
      data-slot="field-description"
      className={cn("text-caption text-ink-muted", className)}
      {...props}
    />
  )
}

function FieldError({ className, ...props }: React.ComponentProps<"p">) {
  const field = useFieldContext()
  if (!field?.error) return null
  return (
    <p
      id={field.errorId}
      role="alert"
      data-slot="field-error"
      className={cn("text-caption text-danger-ink", className)}
      {...props}
    >
      {field.error}
    </p>
  )
}

/**
 * Combines description/error ids for a control inside a Field.
 *
 * `aria-describedby` must never reference an id that isn't actually in the
 * DOM — assistive tech silently drops a dangling IDREF, but a linter or
 * axe rule can still flag it, and it's simply wrong. So `descriptionId` is
 * included only when a `FieldDescription` has registered its presence via
 * `registerDescription` (see `FieldDescription`'s layout effect) — NOT
 * unconditionally from context. `errorId` is included whenever `error` is
 * set, since `FieldError` renders synchronously (no registration needed:
 * it's conditioned on `field.error` in the same render, not a mounted
 * child announcing itself later). When both are present, the error id is
 * ordered first, so screen readers announce the error before the hint.
 * Field's own tests assert `toHaveAccessibleDescription` and exact
 * `aria-describedby` values to catch violations of this contract; each
 * form built on Field should carry the same assertion for its own fields.
 */
export function fieldControlProps(field: FieldContextValue | null) {
  if (!field) return {}
  const describedBy = [
    field.error ? field.errorId : null,
    field.hasDescription ? field.descriptionId : null,
  ].filter(Boolean)
  return {
    id: field.id,
    "aria-invalid": field.invalid || undefined,
    "aria-describedby": describedBy.length ? describedBy.join(" ") : undefined,
  }
}

/**
 * The field chrome every text-like control shares: field height and radius,
 * the half-pixel edge in `line-strong` (the one line that clears 3:1), the
 * focus halo layered over that edge, and the danger edge when invalid.
 * Exported so a control outside this file (a date input, a number field)
 * can look like an Input without copying the recipe.
 */
export const fieldChromeClassName = cn(
  "min-w-0 rounded-(--np-radius-field) bg-(--np-field-bg) text-body text-ink outline-none",
  "[box-shadow:0_0_0_0.5px_var(--np-line-strong)]",
  "transition-[box-shadow,background-color] duration-(--np-duration-fast) ease-spring-snappy",
  "placeholder:text-ink-muted",
  "focus-visible:[box-shadow:var(--np-focus-halo),0_0_0_0.5px_var(--np-line-strong)]",
  "aria-invalid:[box-shadow:0_0_0_0.5px_var(--np-danger-line)]",
  "aria-invalid:focus-visible:[box-shadow:var(--np-focus-halo),0_0_0_0.5px_var(--np-danger-line)]",
  "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
)

export { Field, FieldDescription, FieldError, FieldLabel }
