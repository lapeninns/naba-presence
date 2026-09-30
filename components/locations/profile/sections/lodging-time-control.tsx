"use client"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { LodgingEditorNode } from "@/lib/locations/forms/lodging-catalogue"
import { lodgingRecord } from "@/lib/locations/forms/lodging-draft"

const pad = (value: number) => String(value).padStart(2, "0")
const inRange = (value: unknown, max: number) =>
  value === undefined ||
  (Number.isInteger(value) &&
    typeof value === "number" &&
    value >= 0 &&
    value <= max)

/**
 * A google.type.TimeOfDay as "HH:MM" (24-hour). Proto3 omits zero fields, so a
 * recorded object with no hours means 00; only an absent object is unrecorded.
 * Returns null when Google supplied a shape this control cannot show.
 */
export function lodgingTimeText(value: unknown): string | null {
  if (value === undefined) return ""
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null
  const time = lodgingRecord(value)
  if (!inRange(time.hours, 23) || !inRange(time.minutes, 59)) return null
  return `${pad(typeof time.hours === "number" ? time.hours : 0)}:${pad(typeof time.minutes === "number" ? time.minutes : 0)}`
}

/** Writes hours and minutes, keeping recorded seconds, nanos and any other recorded parts. */
export function lodgingTimeValue(
  text: string,
  current: unknown
): Record<string, unknown> | undefined {
  const match = /^(\d{2}):(\d{2})/.exec(text)
  if (!match) return undefined
  return {
    ...lodgingRecord(current),
    hours: Number(match[1]),
    minutes: Number(match[2]),
  }
}

export function LodgingTimeControl({
  node,
  value,
  original,
  disabled,
  error,
  added = false,
  onChange,
}: {
  readonly node: Extract<LodgingEditorNode, { readonly kind: "time" }>
  readonly value: unknown
  readonly original: unknown
  readonly disabled: boolean
  readonly error?: string
  readonly added?: boolean
  readonly onChange: (value: unknown) => void
}) {
  const text = lodgingTimeText(value)
  const dirty = JSON.stringify(value) !== JSON.stringify(original)
  return (
    <Field error={error}>
      <FieldLabel>{node.label}</FieldLabel>
      <Input
        type="time"
        step={60}
        className="max-w-40"
        value={text ?? ""}
        disabled={disabled}
        onChange={(event) =>
          onChange(
            event.target.value === ""
              ? undefined
              : (lodgingTimeValue(event.target.value, value) ?? value)
          )
        }
      />
      {error ? null : text === null ? (
        <FieldDescription>
          Google supplied a time this editor cannot show. It is preserved until
          you enter a new time.
        </FieldDescription>
      ) : value === undefined ? (
        <FieldDescription>
          {added
            ? "Not set yet. Enter a 24-hour time, such as 15:00."
            : "Google has not recorded a time. Enter a 24-hour time, such as 15:00."}
        </FieldDescription>
      ) : (
        <FieldDescription>24-hour time.</FieldDescription>
      )}
      <FieldError />
      {dirty ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => onChange(original)}
        >
          Reset {node.label.toLowerCase()}
        </Button>
      ) : null}
    </Field>
  )
}
