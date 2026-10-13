"use client"

import { CheckIcon } from "lucide-react"
import * as React from "react"

import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export type ConfirmationMatch = "insensitive" | "exact"

/**
 * Whether the typed text confirms `expected`.
 *
 * - `insensitive` (default): both sides trimmed, runs of whitespace collapsed
 *   to one space, compared case-insensitively. Typing "the old  crown" for
 *   "The Old Crown" is clearly the same intent; the friction we want is
 *   reading the name, not matching its capitals.
 * - `exact`: both sides trimmed only. For irreversible requests where the
 *   name itself is the evidence (a lifecycle request sent to Google).
 *
 * An empty `expected` never matches, not even an empty value: a dialog
 * rendered before its name loads must not arm its destructive button.
 */
export function confirmationMatches(
  value: string,
  expected: string,
  match: ConfirmationMatch = "insensitive"
): boolean {
  const canon = (text: string) =>
    match === "exact"
      ? text.trim()
      : text.trim().replace(/\s+/g, " ").toLocaleLowerCase()
  const target = canon(expected)
  return target.length > 0 && canon(value) === target
}

/**
 * "Type the name to confirm" — a complete field (label, input, optional
 * description, status line) guarding a destructive action.
 *
 * The status says "Matches" once the text confirms, politely (`aria-live=
 * "polite"`, never `role="alert"`): a match is good news, not an error, and an
 * alert would interrupt the person mid-word. Before a match it says nothing —
 * "Doesn't match" after every keystroke of a half-typed name is noise. The
 * caller's confirm button stays disabled until `onMatchChange(true)`.
 *
 * Consumers to migrate:
 * - `components/locations/danger-zone-dialog.tsx` — trims and lowercases;
 *   use the default `match="insensitive"` (which also collapses inner spaces)
 *   and drive the confirm button from `onMatchChange`.
 * - `components/locations/administration/lifecycle-review.tsx` — compares
 *   `typedName !== locationName` raw; use `match="exact"`. Note "exact" trims,
 *   so a stray trailing space from autofill no longer blocks sending.
 */
export type TypedConfirmationProps = Omit<
  React.ComponentProps<typeof Input>,
  "value" | "defaultValue" | "onChange"
> & {
  /** The text the person must type (a location name, usually). */
  expected: string
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  /** Fires when the match state flips (and not on every keystroke). */
  onMatchChange?: (matched: boolean) => void
  match?: ConfirmationMatch
  /** Replaces the default "Type **expected** to confirm" label. */
  label?: React.ReactNode
  /** Hint beneath the input. */
  description?: React.ReactNode
  /** Classes for the wrapping Field. */
  fieldClassName?: string
}

function TypedConfirmation({
  expected,
  value: valueProp,
  defaultValue,
  onValueChange,
  onMatchChange,
  match = "insensitive",
  label,
  description,
  fieldClassName,
  ...props
}: TypedConfirmationProps) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue ?? "")
  const value = valueProp ?? uncontrolled
  const matched = confirmationMatches(value, expected, match)

  // Report flips, not keystrokes; an effect (not the change handler) so a
  // controlled parent resetting the value, or `expected` loading late, is
  // reported too. Starts at false: nothing is confirmed before typing.
  const reported = React.useRef(false)
  React.useEffect(() => {
    if (reported.current === matched) return
    reported.current = matched
    onMatchChange?.(matched)
  }, [matched, onMatchChange])

  return (
    <Field className={fieldClassName}>
      <FieldLabel>
        {label ?? (
          <span>
            Type <strong className="font-semibold">{expected}</strong> to
            confirm
          </span>
        )}
      </FieldLabel>
      <Input
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        data-matched={matched || undefined}
        {...props}
        value={value}
        onChange={(event) => {
          if (valueProp === undefined) setUncontrolled(event.target.value)
          onValueChange?.(event.target.value)
        }}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {/* Always mounted so the live region exists before its first message;
          screen readers skip announcements into a freshly inserted region. */}
      <p
        aria-live="polite"
        data-slot="typed-confirmation-status"
        className={cn(
          "flex min-h-4 items-center gap-1.5 text-caption font-medium text-ink-muted",
          matched && "text-success-ink"
        )}
      >
        {matched ? (
          <>
            <CheckIcon aria-hidden strokeWidth={2} className="size-3.5" />
            Matches
          </>
        ) : null}
      </p>
    </Field>
  )
}

export { TypedConfirmation }
