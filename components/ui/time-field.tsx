"use client"

import * as React from "react"

import {
  fieldChromeClassName,
  fieldControlProps,
  useFieldContext,
} from "@/components/ui/field"
import { cn } from "@/lib/utils"

/**
 * A 24-hour "HH:MM" time entry field for opening hours.
 *
 * Why not `<input type="time">`: opening hours need `24:00` ("closes at
 * midnight at the end of the day", Google's own representation), and the
 * native time input cannot express it — it wraps to `00:00`, which reads as
 * "closes at the start of the day". The native control also renders 12-hour
 * AM/PM in some locales and a spinner UI that is slow to correct on touch.
 * So the hours editor stores plain "HH:MM" strings and this field edits them
 * as text, but with `inputMode="numeric"` so phones open the digit pad
 * instead of the full keyboard.
 *
 * Numeric pads (iOS especially) have no colon key, so the colon is inserted
 * for the person as they type (see `formatTimeDigits`), and the value is
 * tidied on blur (see `normalizeTimeInput`). Anything that still is not a
 * time is left exactly as typed so the form's validator can name the problem
 * instead of the field silently inventing a time.
 *
 * Adopting in `components/locations/hours-editor.tsx`: replace
 *
 *   <Input type="text" inputMode="text" placeholder="HH:MM"
 *     value={period.opensAt} onChange={(e) => set(e.target.value)}
 *     className={TIME_CLASS} … />
 *
 * with
 *
 *   <TimeField value={period.opensAt} onValueChange={set} … />
 *
 * keeping `id`, `aria-label`, `aria-invalid`, `aria-describedby` and
 * `disabled` as they are (explicit props override the Field wiring).
 * `TIME_CLASS` can go: the field is already compact and tabular.
 */
export type TimeFieldProps = Omit<
  React.ComponentProps<"input">,
  "type" | "value" | "defaultValue"
> & {
  /** Controlled "HH:MM" value (may be partial or invalid while editing). */
  value?: string
  /** Uncontrolled initial value. */
  defaultValue?: string
  /**
   * Called with the formatted value on every edit and with the normalised
   * value on blur (when normalising changed it). Prefer this over `onChange`:
   * the blur tidy-up has no change event.
   */
  onValueChange?: (next: string) => void
  /**
   * Whether `24:00` (midnight at the end of the day) is a valid time. Default
   * true. When false, `24` is not treated as a two-digit hour while typing
   * and the native `pattern` excludes it.
   */
  allowEndOfDay?: boolean
}

const TIME_PATTERN = "(?:[01]\\d|2[0-3]):[0-5]\\d"
const TIME_PATTERN_END_OF_DAY = `${TIME_PATTERN}|24:00`

/** True for a complete "HH:MM" 24-hour time; `24:00` only when allow24. */
export function isValidTime(
  value: string,
  { allow24 = true }: { allow24?: boolean } = {}
): boolean {
  return new RegExp(
    `^(?:${allow24 ? TIME_PATTERN_END_OF_DAY : TIME_PATTERN})$`
  ).test(value)
}

/** Keeps digits and the first colon only; everything else is dropped. */
function sanitize(raw: string): string {
  const colon = raw.indexOf(":")
  if (colon === -1) return raw.replace(/\D/g, "")
  return `${raw.slice(0, colon).replace(/\D/g, "")}:${raw
    .slice(colon + 1)
    .replace(/\D/g, "")}`
}

/**
 * Live formatting while typing: digits plus an auto-inserted colon.
 *
 * - A colon the person typed is kept (first one only), hours and minutes are
 *   capped at two digits each: "9:" stays "9:", "9:305" → "9:30".
 * - Without a colon, the hour is two digits when the first two digits form
 *   an hour (00–23, or 24 when `allow24`), otherwise one: "093" → "09:3",
 *   "0930" → "09:30", but "93" → "9:3" and "930" → "9:30" (93 is not an
 *   hour, so 9 must be). This is what lets "930" mean half past nine.
 * - Never appends a trailing colon ("09" stays "09"), so backspace is never
 *   fighting an auto-inserted character.
 */
export function formatTimeDigits(
  raw: string,
  { allow24 = true }: { allow24?: boolean } = {}
): string {
  const clean = sanitize(raw)
  if (clean.includes(":")) {
    const [hours, minutes] = clean.split(":")
    return `${hours.slice(0, 2)}:${minutes.slice(0, 2)}`
  }
  const digits = clean.slice(0, 4)
  if (digits.length <= 1) return digits
  const twoDigitHour = Number(digits.slice(0, 2)) <= (allow24 ? 24 : 23)
  if (twoDigitHour) {
    return digits.length <= 2
      ? digits
      : `${digits.slice(0, 2)}:${digits.slice(2)}`
  }
  return `${digits[0]}:${digits.slice(1, 3)}`
}

/**
 * Blur normalisation to "HH:MM". Rules (whitespace trimmed first):
 *
 * - "H" / "HH"        → "0H:00" / "HH:00"   ("9" → "09:00")
 * - "HMM"             → "0H:MM"             ("930" → "09:30")
 * - "HHMM"            → "HH:MM"             ("2400" → "24:00")
 * - "H:" / "H:MM" / "HH:" → hour padded, minutes "00" when empty
 *
 * A single minute digit ("9:5") is ambiguous — 9:05 or 9:50? — so it is not
 * guessed. Whenever the result would not be a valid time (per `allow24`),
 * the original text comes back unchanged so the validator reports it.
 */
export function normalizeTimeInput(
  raw: string,
  { allow24 = true }: { allow24?: boolean } = {}
): string {
  const text = raw.trim()
  let candidate: string | null = null
  const colon = /^(\d{1,2}):(\d{2})?$/.exec(text)
  if (colon) {
    candidate = `${colon[1].padStart(2, "0")}:${colon[2] ?? "00"}`
  } else if (/^\d{1,2}$/.test(text)) {
    candidate = `${text.padStart(2, "0")}:00`
  } else if (/^\d{3,4}$/.test(text)) {
    const padded = text.padStart(4, "0")
    candidate = `${padded.slice(0, 2)}:${padded.slice(2)}`
  }
  return candidate && isValidTime(candidate, { allow24 }) ? candidate : raw
}

function TimeField({
  className,
  value: valueProp,
  defaultValue,
  onValueChange,
  onChange,
  onBlur,
  allowEndOfDay = true,
  ...props
}: TimeFieldProps) {
  const field = useFieldContext()
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue ?? "")
  const isControlled = valueProp !== undefined
  const value = isControlled ? valueProp : uncontrolled

  const commit = (next: string) => {
    if (!isControlled) setUncontrolled(next)
    onValueChange?.(next)
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      enterKeyHint="next"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      placeholder="HH:MM"
      maxLength={5}
      pattern={allowEndOfDay ? TIME_PATTERN_END_OF_DAY : TIME_PATTERN}
      data-slot="time-field"
      className={cn(
        fieldChromeClassName,
        "h-(--np-field-h) w-26 px-(--np-field-pad-x) py-(--np-field-pad-y) font-mono tabular-nums",
        className
      )}
      {...fieldControlProps(field)}
      {...props}
      value={value}
      onChange={(event) => {
        const raw = event.currentTarget.value
        // Format only when text was added. On a deletion we just drop stray
        // characters: re-inserting the colon after someone backspaced over
        // it ("09:|30" → "0930" → "09:30") would trap the caret forever.
        const next =
          raw.length < value.length
            ? sanitize(raw)
            : formatTimeDigits(raw, { allow24: allowEndOfDay })
        // Hand the formatted text to a plain `onChange` caller too, so
        // `onChange={(e) => set(e.target.value)}` keeps working on adoption.
        event.currentTarget.value = next
        commit(next)
        onChange?.(event)
      }}
      onBlur={(event) => {
        const next = normalizeTimeInput(value, { allow24: allowEndOfDay })
        if (next !== value) commit(next)
        onBlur?.(event)
      }}
    />
  )
}

export { TimeField }
