"use client"

import { CircleAlert } from "lucide-react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
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
   * True while a `FieldError` with its own children is mounted. Lets a
   * conditionally rendered `<FieldError>Reason</FieldError>` mark the control
   * invalid and describe it, exactly as `<Field error>` does.
   */
  registerError: (present: boolean) => void
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
 * How wide a Field may grow. A field fills its column, which is right for
 * long text (a description, an address) but leaves a short value (a name, a
 * code) in a 700-930px bar on a desk, where the eye travels a long way to
 * its end.
 *
 * - `full` (default): the whole column.
 * - `short`: the column on a phone, and at most `max-w-md` on a desk, for a
 *   single-line value of a few words. The label, hint and error share the
 *   field's width, so they stay aligned with it.
 */
export type FieldMeasure = "full" | "short"

export const fieldMeasureClassName: Record<FieldMeasure, string | undefined> = {
  full: undefined,
  short: "desk:max-w-md",
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
  measure = "full",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  error?: string
  /** A desk width limit for short single-line values; see `FieldMeasure`. */
  measure?: FieldMeasure
}) {
  const id = useId()
  const [hasDescription, setHasDescription] = useState(false)
  const [controlLabelable, setControlLabelable] = useState(true)
  const [hasChildError, setHasChildError] = useState(false)
  const invalid = Boolean(error) || hasChildError
  return (
    <FieldContext.Provider
      value={{
        id,
        labelId: `${id}-label`,
        errorId: `${id}-error`,
        descriptionId: `${id}-description`,
        invalid,
        error,
        hasDescription,
        registerDescription: setHasDescription,
        registerError: setHasChildError,
        controlLabelable,
        registerControl: setControlLabelable,
      }}
    >
      <div
        data-slot="field"
        data-invalid={invalid ? "" : undefined}
        data-measure={measure === "full" ? undefined : measure}
        className={cn(
          "flex min-w-0 flex-col gap-1.5",
          fieldMeasureClassName[measure],
          className
        )}
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
        "gap-1.5 text-ui leading-5 font-medium text-ink-secondary",
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
 * How a form's errors reach a screen reader.
 *
 * Every FieldError used to be its own `role="alert"`, so a failed submit that
 * marked five fields fired five alerts over each other (and over the
 * ValidationSummary, itself an alert that also takes focus). Wrapping the
 * form in `FormErrorScope` makes the errors inside it quiet text — still
 * wired to their controls by `aria-describedby`, so they are read when the
 * person lands on the field — and gives the scope ONE polite live region:
 *
 *   - With a `ValidationSummary` mounted inside the scope, the summary is the
 *     announcement (it is the alert and takes focus); the region stays empty.
 *   - Without one, the region says the first error and how many there are
 *     ("Enter a business name. 2 more fields need attention."), once per
 *     change, so an inline blur check still speaks without stacking.
 *
 * Outside any scope a FieldError keeps `role="alert"`, so forms that have not
 * adopted the scope behave exactly as before. `announce` on a FieldError
 * overrides either default.
 */
type FormErrorScopeValue = {
  report: (key: string, message: string | null) => void
  registerSummary: (present: boolean) => void
}

const FormErrorScopeContext = createContext<FormErrorScopeValue | null>(null)

export function useFormErrorScope() {
  return useContext(FormErrorScopeContext)
}

function FormErrorScope({ children }: { children: React.ReactNode }) {
  // Insertion-ordered, so "the first error" is the first field that failed
  // in document order on a submit (fields mount their errors top-down).
  const errorsRef = useRef(new Map<string, string>())
  const [summaryCount, setSummaryCount] = useState(0)
  const [announcement, setAnnouncement] = useState("")
  const [version, setVersion] = useState(0)

  const report = useCallback((key: string, message: string | null) => {
    const errors = errorsRef.current
    if (message === null) {
      if (!errors.delete(key)) return
    } else {
      if (errors.get(key) === message) return
      errors.set(key, message)
    }
    setVersion((value) => value + 1)
  }, [])

  const registerSummary = useCallback((present: boolean) => {
    setSummaryCount((count) => Math.max(0, count + (present ? 1 : -1)))
  }, [])

  // Batched to one update per render pass: five errors mounting together
  // produce one sentence, not five rewrites of the region.
  useEffect(() => {
    const errors = [...errorsRef.current.values()]
    if (summaryCount > 0 || errors.length === 0) {
      setAnnouncement("")
      return
    }
    const more = errors.length - 1
    setAnnouncement(
      more > 0
        ? `${errors[0]} ${more} more ${more === 1 ? "field needs" : "fields need"} attention.`
        : errors[0]
    )
  }, [version, summaryCount])

  const value = useMemo(
    () => ({ report, registerSummary }),
    [report, registerSummary]
  )

  return (
    <FormErrorScopeContext.Provider value={value}>
      {children}
      <span
        data-slot="form-error-announcer"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </span>
    </FormErrorScopeContext.Provider>
  )
}

type ErrorAnnounce = "alert" | "polite" | "off"

function announceProps(announce: ErrorAnnounce) {
  if (announce === "alert") return { role: "alert" as const }
  if (announce === "polite") return { "aria-live": "polite" as const }
  return {}
}

/**
 * The error beneath a field (reference `.error-text`): danger ink, a leading
 * alert glyph, and the reason in words.
 *
 * The reason is the children when given, otherwise the Field's `error`. A
 * `<FieldError>` with children inside a `<Field>` with no `error` used to
 * render nothing at all (the danger-zone destination check was silently
 * invisible); now it renders and marks the control invalid, so a
 * conditionally mounted `{bad ? <FieldError>Why</FieldError> : null}` is a
 * complete error on its own. Renders nothing when there is no reason.
 */
function FieldError({
  className,
  children,
  announce,
  ...props
}: React.ComponentProps<"p"> & {
  /** Overrides the scope default; see `FormErrorScope`. */
  announce?: ErrorAnnounce
}) {
  const field = useFieldContext()
  const hasChildren =
    children !== undefined &&
    children !== null &&
    children !== false &&
    children !== ""
  const content = hasChildren ? children : field?.error
  if (!content) return null
  return (
    <FieldErrorMessage
      className={className}
      announce={announce}
      ownsError={hasChildren}
      text={typeof content === "string" ? content : undefined}
      {...props}
    >
      {content}
    </FieldErrorMessage>
  )
}

function FieldErrorMessage({
  className,
  children,
  announce,
  ownsError,
  text,
  ...props
}: React.ComponentProps<"p"> & {
  announce?: ErrorAnnounce
  ownsError: boolean
  text?: string
}) {
  const field = useFieldContext()
  const scope = useFormErrorScope()
  const ref = useRef<HTMLParagraphElement>(null)
  const key = useId()
  const registerError = field?.registerError
  const report = scope?.report

  // Same layout-effect reasoning as FieldDescription: the control picks up
  // aria-invalid and the error id before the browser paints.
  useLayoutEffect(() => {
    if (!ownsError) return
    registerError?.(true)
    return () => registerError?.(false)
  }, [ownsError, registerError])

  // The scope reads the words, not the node: `text` when the reason is a
  // string, otherwise whatever the rendered paragraph says.
  useLayoutEffect(() => {
    if (!report) return
    report(key, text ?? ref.current?.textContent ?? "")
    return () => report(key, null)
  }, [report, key, text])

  const mode: ErrorAnnounce = announce ?? (scope ? "off" : "alert")

  return (
    <p
      ref={ref}
      id={field?.errorId}
      data-slot="field-error"
      {...announceProps(mode)}
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
      <span className="min-w-0">{children}</span>
    </p>
  )
}

/**
 * An error that belongs to the whole form or workflow, not one field: the
 * save failed, Google refused the request, the session expired. Same ink and
 * glyph as FieldError at the body size, announced as an alert (one at a
 * time — a workflow has one current failure). Replaces the hand-rolled
 * `<p role="alert" className="text-ui text-danger-ink">` paragraphs. Renders
 * nothing without children, so `<FormError>{error}</FormError>` is safe.
 */
function FormError({
  className,
  children,
  announce = "alert",
  ...props
}: React.ComponentProps<"div"> & { announce?: ErrorAnnounce }) {
  if (
    children === undefined ||
    children === null ||
    children === false ||
    children === ""
  )
    return null
  return (
    <div
      data-slot="form-error"
      {...announceProps(announce)}
      className={cn(
        "flex items-start gap-2 text-ui font-medium text-danger-ink",
        className
      )}
      {...props}
    >
      <CircleAlert
        aria-hidden
        strokeWidth={1.75}
        className="mt-0.5 size-4 shrink-0"
      />
      <div className="min-w-0">{children}</div>
    </div>
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
 * unconditionally from context. `errorId` is included whenever the Field is
 * invalid: from `error`, which `FieldError` renders in the same pass, or
 * from a FieldError with its own children, which registers itself the same
 * way a description does. When both are present, the error id is
 * ordered first, so screen readers announce the error before the hint.
 * Field's own tests assert `toHaveAccessibleDescription` and exact
 * `aria-describedby` values to catch violations of this contract; each
 * form built on Field should carry the same assertion for its own fields.
 */
export function fieldControlProps(field: FieldContextValue | null) {
  if (!field) return {}
  const describedBy = [
    field.invalid ? field.errorId : null,
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
 * when disabled or read-only. `text-body` is 16px everywhere but the desk
 * (fine pointer and a wide window), which is what stops iOS zooming into a
 * focused field — no separate coarse-pointer patch is needed.
 * Exported so a control outside this file (a date input, a number field)
 * can look like an Input without copying the recipe.
 */
export const fieldChromeClassName = cn(
  "min-w-0 rounded-(--np-radius-field) border border-line-strong bg-(--np-field-bg) text-body text-ink outline-none",
  "transition-[border-color,box-shadow,background-color] duration-(--np-duration-fast) ease-spring-snappy",
  "placeholder:text-ink-muted hover:border-ink-muted",
  "focus:border-primary focus:shadow-(--np-field-ring) focus-visible:border-primary focus-visible:shadow-(--np-field-ring)",
  "aria-invalid:border-danger-ink aria-invalid:shadow-(--np-field-ring-invalid)",
  "read-only:bg-surface-alt read-only:text-ink-muted disabled:cursor-not-allowed disabled:bg-surface-alt disabled:text-ink-muted"
)

/**
 * A byte or character counter beneath a field (reference `.counter`): sans
 * tabular figures, muted, and danger ink once `over`. Say the limit in the text itself
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
        "text-count text-ink-muted tabular-nums",
        isOver && "font-semibold text-danger-ink",
        className
      )}
      {...props}
    />
  )
}

export {
  Field,
  FieldCounter,
  FieldDescription,
  FieldError,
  FieldLabel,
  FormError,
  FormErrorScope,
}
