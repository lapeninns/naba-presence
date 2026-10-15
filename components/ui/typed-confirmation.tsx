"use client"

import { CheckIcon } from "lucide-react"
import * as React from "react"

import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input, inputHints } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export type ConfirmationMatch = "insensitive" | "exact" | "trimmed-insensitive"

/**
 * A caller's own rule: does `value` confirm `expected`? Only asked when
 * `expected` has something to match (it is never called with a blank one).
 */
export type ConfirmationMatcher = (value: string, expected: string) => boolean

/**
 * Whether the typed text confirms `expected`.
 *
 * - `insensitive` (default): both sides trimmed, runs of whitespace collapsed
 *   to one space, compared case-insensitively. Typing "the old  crown" for
 *   "The Old Crown" is clearly the same intent; the friction we want is
 *   reading the name, not matching its capitals.
 * - `exact`: both sides trimmed only. For irreversible requests where the
 *   name itself is the evidence (a lifecycle request sent to Google).
 * - `trimmed-insensitive`: both sides trimmed and lowercased
 *   (`toLowerCase`), inner spaces kept as typed, so "camden  hotel" (two
 *   spaces) does NOT match "Camden Hotel". The rule a guard such as
 *   DangerZoneDialog already enforces; pick it so the "Matches" line and
 *   that guard agree.
 * - `matcher` (when given) replaces `match` entirely.
 *
 * An empty or blank `expected` never matches, not even an empty value, in
 * every mode and before any `matcher` is asked: a dialog rendered before its
 * name loads must not arm its destructive button.
 *
 * Callers that gate a button themselves should gate it with this same
 * function and the same arguments (or with `onMatchChange`), so the visible
 * "Matches" and the button's arming can never disagree.
 */
export function confirmationMatches(
  value: string,
  expected: string,
  match: ConfirmationMatch = "insensitive",
  matcher?: ConfirmationMatcher
): boolean {
  if (expected.trim().length === 0) return false
  if (matcher) return matcher(value, expected) === true
  const canon = (text: string) => {
    switch (match) {
      case "exact":
        return text.trim()
      case "trimmed-insensitive":
        return text.trim().toLowerCase()
      default:
        return text.trim().replace(/\s+/g, " ").toLocaleLowerCase()
    }
  }
  return canon(value) === canon(expected)
}

/**
 * Keyboard hints for typing `expected` exactly. An email gets the email
 * keyboard (it has the "@" key); everything else keeps the plain text one.
 * Both stop the phone capitalising or "correcting" what is typed. `type`
 * stays `text`, so the browser never validates or trims a half-typed address.
 */
export function typedConfirmationHints(expected: string) {
  return {
    ...(expected.includes("@")
      ? { inputMode: inputHints.email.inputMode }
      : {}),
    autoComplete: "off",
    autoCapitalize: "none",
    autoCorrect: "off",
    spellCheck: false,
  } as const
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
 * - `components/locations/danger-zone-dialog.tsx` — trims and lowercases
 *   without collapsing inner spaces; pass `match="trimmed-insensitive"` and
 *   gate the button with `confirmationMatches(typed, expectedName,
 *   "trimmed-insensitive")` (or `onMatchChange`), so the line and the
 *   button use one rule and the guard is exactly as strict as before.
 * - `components/locations/administration/lifecycle-review.tsx` — compares
 *   `typedName !== locationName` raw; use `match="exact"`. Note "exact" trims,
 *   so a stray trailing space from autofill no longer blocks sending.
 */
export type TypedConfirmationProps = Omit<
  React.ComponentProps<typeof Input>,
  "value" | "defaultValue" | "onChange"
> & {
  /**
   * The text the person must type (a location name, usually).
   *
   * It may be `null` or empty while it loads or when the source has none (a
   * Google connection whose email is unknown). Then `fallbackExpected` is
   * asked for instead; with no fallback either, nothing can match, so the
   * caller's destructive button never arms (see `confirmationMatches`).
   */
  expected: string | null | undefined
  /**
   * What to ask for when `expected` is `null`, `undefined` or blank, e.g.
   * the connection's display name when its Google email is unknown. The
   * label and the match both use it.
   */
  fallbackExpected?: string | null
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  /** Fires when the match state flips (and not on every keystroke). */
  onMatchChange?: (matched: boolean) => void
  /**
   * How the typed text is compared (see `confirmationMatches`). The same
   * rule drives the "Matches" line, `data-matched` and `onMatchChange`, so
   * a confirm button armed by `onMatchChange` always agrees with the line.
   */
  match?: ConfirmationMatch
  /**
   * A caller's own comparison, replacing `match`. Still never asked when
   * `expected` is blank: with nothing to match, nothing matches.
   */
  matcher?: ConfirmationMatcher
  /** Replaces the default "Type **expected** to confirm" label. */
  label?: React.ReactNode
  /** Hint beneath the input. */
  description?: React.ReactNode
  /** Classes for the wrapping Field. */
  fieldClassName?: string
}

function TypedConfirmation({
  expected: expectedProp,
  fallbackExpected,
  value: valueProp,
  defaultValue,
  onValueChange,
  onMatchChange,
  match = "insensitive",
  matcher,
  label,
  description,
  fieldClassName,
  ...props
}: TypedConfirmationProps) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue ?? "")
  const value = valueProp ?? uncontrolled
  const expected =
    expectedProp && expectedProp.trim().length > 0
      ? expectedProp
      : (fallbackExpected ?? "")
  const matched = confirmationMatches(value, expected, match, matcher)

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
        {...typedConfirmationHints(expected)}
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
