"use client"

import { createContext, useContext, useId } from "react"

import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

type FieldContextValue = {
  id: string
  errorId: string
  descriptionId: string
  invalid: boolean
  error?: string
}

const FieldContext = createContext<FieldContextValue | null>(null)

export function useFieldContext() {
  return useContext(FieldContext)
}

function Field({
  error,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { error?: string }) {
  const id = useId()
  return (
    <FieldContext.Provider
      value={{
        id,
        errorId: `${id}-error`,
        descriptionId: `${id}-description`,
        invalid: Boolean(error),
        error,
      }}
    >
      <div
        data-slot="field"
        className={cn("flex flex-col gap-1.5", className)}
        {...props}
      >
        {children}
      </div>
    </FieldContext.Provider>
  )
}

function FieldLabel(props: React.ComponentProps<typeof Label>) {
  const field = useFieldContext()
  return <Label htmlFor={field?.id} {...props} />
}

function FieldDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  const field = useFieldContext()
  return (
    <p
      id={field?.descriptionId}
      data-slot="field-description"
      className={cn("text-caption text-muted-foreground", className)}
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
      className={cn("text-caption text-destructive", className)}
      {...props}
    >
      {field.error}
    </p>
  )
}

/**
 * Combines description/error ids for a control inside a Field.
 *
 * Caveat: `aria-describedby` is computed here from context alone, without
 * knowing whether a `FieldDescription`/`FieldError` will actually render in
 * the DOM — pointing `aria-describedby` at an id that never mounts is
 * invalid, and assistive tech will silently drop the missing reference.
 * The contract this relies on to stay correct: `descriptionId` is ALWAYS
 * included below, so any `Field` that expects a description MUST render a
 * `FieldDescription` (unconditionally, not behind its own condition) so
 * that id resolves; `errorId` is included only when `error` is set, and —
 * when both are present — the error id is ordered first, so screen readers
 * announce the error before the hint. Field's own tests assert
 * `toHaveAccessibleDescription` to catch violations of this contract; each
 * form built on Field should carry the same assertion for its own fields.
 */
export function fieldControlProps(field: FieldContextValue | null) {
  if (!field) return {}
  const describedBy = [
    field.error ? field.errorId : null,
    field.descriptionId,
  ].filter(Boolean)
  return {
    id: field.id,
    "aria-invalid": field.invalid || undefined,
    "aria-describedby": describedBy.length ? describedBy.join(" ") : undefined,
  }
}

export { Field, FieldDescription, FieldError, FieldLabel }
