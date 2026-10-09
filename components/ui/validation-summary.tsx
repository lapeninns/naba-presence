"use client"

import { CircleAlert } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

export type ValidationError = {
  /** The `id` of the control to move to. */
  fieldId: string
  /** What is wrong and how to fix it, in words. */
  message: string
}

/**
 * An error summary above a form after a failed submit (reference alert
 * `.bad` drawing). It takes focus when it appears (or when `focusKey`
 * changes, e.g. on each submit), is announced as an alert, and lists every
 * problem as a link that moves focus to the field it names.
 *
 * Props
 *   errors     `{ fieldId, message }[]`; renders nothing when empty.
 *   title      defaults to "Fix 1 problem" / "Fix N problems".
 *   focusKey   change it to re-focus the summary (a submit counter).
 *   autoFocus  default true.
 *
 * Keep the per-field `FieldError` too: the summary is how a keyboard or
 * screen-reader user finds the problems, the field error is how everyone
 * fixes them. Form values are untouched.
 */
function ValidationSummary({
  errors,
  title,
  focusKey,
  autoFocus = true,
  className,
}: {
  errors: ValidationError[]
  title?: string
  focusKey?: string | number
  autoFocus?: boolean
  className?: string
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const titleId = React.useId()
  const hasErrors = errors.length > 0

  React.useEffect(() => {
    if (autoFocus && hasErrors) ref.current?.focus()
  }, [autoFocus, hasErrors, focusKey])

  if (!hasErrors) return null

  const heading =
    title ??
    (errors.length === 1 ? "Fix 1 problem" : `Fix ${errors.length} problems`)

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      aria-labelledby={titleId}
      data-slot="validation-summary"
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-(--np-radius-card) border border-danger-ink bg-danger-tint px-3.5 py-3 text-ui text-ink outline-none focus-visible:shadow-[0_0_0_3px_var(--np-danger-tint)]",
        className
      )}
    >
      <CircleAlert
        aria-hidden
        strokeWidth={1.75}
        className="mt-0.5 size-4 text-danger-ink"
      />
      <p id={titleId} className="text-body font-semibold">
        {heading}
      </p>
      <ul className="col-start-2 flex list-disc flex-col gap-1 pl-4">
        {errors.map((error) => (
          <li key={`${error.fieldId}-${error.message}`}>
            <a
              href={`#${error.fieldId}`}
              onClick={(event) => {
                const target = document.getElementById(error.fieldId)
                if (!target) return
                event.preventDefault()
                target.scrollIntoView({ block: "center" })
                target.focus({ preventScroll: true })
              }}
              className="rounded-(--np-radius-tag) font-medium text-danger-ink underline underline-offset-3 focus-halo hover:decoration-2"
            >
              {error.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

export { ValidationSummary }
