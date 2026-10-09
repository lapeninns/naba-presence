"use client"

import { CircleAlert } from "lucide-react"
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
  labelId: string
  errorId: string
  descriptionId: string
  invalid: boolean
  error?: string
  hasDescription: boolean
  registerDescription: (present: boolean) => void
  /**
   * False once a control that `<label for>` cannot reach (a pop-up button, a
   * segmented track) has claimed the Field. See `useFieldTriggerProps`.
   */
  controlLabelable: boolean
  registerControl: (labelable: boolean) => void
}

const FieldContext = createContext<FieldContextValue | null>(null)

export function useFieldContext() {
  return useContext(FieldContext)
}

/**
 * A labelled form control (reference `.field`): label above in the UI role at
 * semibold, the control, then a caption-sized hint or error beneath, 6px
 * apart. The Field
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
  const [controlLabelable, setControlLabelable] = useState(true)
  return (
    <FieldContext.Provider
      value={{
        id,
        labelId: `${id}-label`,
        errorId: `${id}-error`,
        descriptionId: `${id}-description`,
        invalid: Boolean(error),
        error,
        hasDescription,
        registerDescription: setHasDescription,
        controlLabelable,
        registerControl: setControlLabelable,
      }}
    >
      <div
        data-slot="field"
        data-invalid={error ? "" : undefined}
        className={cn("flex min-w-0 flex-col gap-1.5", className)}
        {...props}
      >
        {children}
      </div>
    </FieldContext.Provider>
  )
}

/**
 * The Field's visible label.
 *
 * `htmlFor` is dropped once the Field holds a control `<label for>` cannot
 * reach — a Select's pop-up button is a `<button>`, which is not a labelable
 * element, so pointing at it produced a label that named nothing and did
 * nothing when clicked. Those controls take the label by `aria-labelledby`
 * instead (`useFieldTriggerProps`), which is why the label always carries an
 * id of its own.
 */
function FieldLabel({
  className,
  optional,
  children,
  ...props
}: React.ComponentProps<typeof Label> & {
  /**
   * Marks the field optional in words after the label ("optional" by
   * default, or your own text, e.g. "read only"). Becomes part of the name.
   */
  optional?: boolean | string
}) {
  const field = useFieldContext()
  return (
    <Label
      id={field?.labelId}
      htmlFor={field && !field.controlLabelable ? undefined : field?.id}
      className={cn(
        "gap-1.5 text-ui leading-5 font-semibold text-ink",
        className
      )}
      {...props}
    >
      {children}
      {optional ? (
        <span className="font-normal text-ink-muted">
          ({typeof optional === "string" ? optional : "optional"})
        </span>
      ) : null}
    </Label>
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

/**
 * The error beneath a field (reference `.error-text`): danger ink, a leading
 * alert glyph, and the reason in words. Announced as an alert.
 */
function FieldError({ className, ...props }: React.ComponentProps<"p">) {
  const field = useFieldContext()
  if (!field?.error) return null
  return (
    <p
      id={field.errorId}
      role="alert"
      data-slot="field-error"
      className={cn(
        "flex items-start gap-1.5 text-caption font-medium text-danger-ink",
        className
      )}
      {...props}
    >
      <CircleAlert
        aria-hidden
        strokeWidth={1.75}
        className="mt-px size-3.5 shrink-0"
      />
      <span className="min-w-0">{field.error}</span>
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
 * The same wiring as `fieldControlProps`, for a control `<label for>` cannot
 * reach: a Select or Combobox trigger, a segmented track, any pop-up button.
 *
 * Registering tells the Field to stop emitting `htmlFor`, and the label is
 * handed over by `aria-labelledby` instead — but only when the caller has not
 * already named the control. A trigger with its own `aria-label` keeps that
 * name: `aria-labelledby` wins the name computation, so adding it silently
 * would rewrite accessible names that tests, tooling and operators rely on.
 */
export function useFieldTriggerProps({
  hasOwnName = false,
}: { hasOwnName?: boolean } = {}) {
  const field = useFieldContext()
  const registerControl = field?.registerControl

  // Layout effect, and the same reasoning as FieldDescription's: the label
  // must have dropped its `htmlFor` before the browser paints, and the
  // cleanup puts it back when the trigger unmounts.
  useLayoutEffect(() => {
    registerControl?.(false)
    return () => registerControl?.(true)
  }, [registerControl])

  if (!field) return {}
  return {
    ...fieldControlProps(field),
    "aria-labelledby": hasOwnName ? undefined : field.labelId,
  }
}

/**
 * The field chrome every text-like control shares (reference `.input`): the
 * field radius, a 1px `line-strong` edge (the control boundary at 3:1) that
 * darkens on hover, an accent edge plus a 3px accent-tint halo on focus, the
 * danger edge plus danger-tint halo when invalid, and the sunken surface
 * when disabled or read-only. 16px text on coarse pointers stops iOS zoom.
 * Exported so a control outside this file (a date input, a number field)
 * can look like an Input without copying the recipe.
 */
export const fieldChromeClassName = cn(
  "min-w-0 rounded-(--np-radius-field) border border-line-strong bg-(--np-field-bg) text-body text-ink outline-none",
  "transition-[border-color,box-shadow,background-color] duration-(--np-duration-fast) ease-spring-snappy",
  "placeholder:text-ink-muted hover:border-ink-muted",
  "focus:border-primary focus:shadow-[0_0_0_3px_var(--np-accent-tint)] focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_var(--np-accent-tint)]",
  "aria-invalid:border-danger-ink aria-invalid:shadow-[0_0_0_3px_var(--np-danger-tint)]",
  "read-only:bg-surface-alt read-only:text-ink-muted disabled:cursor-not-allowed disabled:bg-surface-alt disabled:text-ink-muted",
  "pointer-coarse:text-base"
)

/**
 * A byte or character counter beneath a field (reference `.counter`): mono,
 * muted, and danger ink once `over`. Say the limit in the text itself
 * ("1,204 / 4,096 bytes"), so colour is not the only warning.
 *
 * Announced only near or over the limit. A live counter far from its limit
 * read "12 / 2,000", "13 / 2,000"… after every keystroke, drowning out what
 * the person was typing. Pass `count` and `max` to let the counter decide
 * (near is the last tenth), or `near` directly.
 */
export const FIELD_COUNTER_NEAR = 0.9

export function fieldCounterIsNear(count: number, max: number): boolean {
  return max > 0 && count >= Math.floor(max * FIELD_COUNTER_NEAR)
}

function FieldCounter({
  over = false,
  near,
  count,
  max,
  className,
  ...props
}: React.ComponentProps<"span"> & {
  over?: boolean
  near?: boolean
  count?: number
  max?: number
}) {
  const isOver =
    over || (count !== undefined && max !== undefined && count > max)
  const isNear =
    near ??
    (count !== undefined && max !== undefined && fieldCounterIsNear(count, max))
  return (
    <span
      data-slot="field-counter"
      data-over={isOver || undefined}
      data-near={isNear || undefined}
      aria-live={isOver || isNear ? "polite" : "off"}
      className={cn(
        "font-mono text-[11.5px] text-ink-muted tabular-nums",
        isOver && "font-semibold text-danger-ink",
        className
      )}
      {...props}
    />
  )
}

export { Field, FieldCounter, FieldDescription, FieldError, FieldLabel }
