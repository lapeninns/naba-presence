"use client"

import { useId } from "react"

import { ChangedMark } from "@/components/locations/profile/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { StatusPill } from "@/components/ui/status-pill"
import { Switch } from "@/components/ui/switch"
import type {
  AttributeMetadata,
  GoogleAttribute,
} from "@/lib/api/location-business-information"
import { attributeControlKind } from "@/lib/locations/console-labels"
import { enumOptionsFor } from "@/lib/locations/google-values"

/**
 * One typed Google attribute as a row (reference `.attr-row`): the label at
 * the leading edge, the control at the trailing edge, wrapping under each
 * other on a narrow row. Only the well-understood value types get an editor;
 * anything else is read-only with the pressure-valve note, never a JSON
 * escape hatch.
 *
 * A BOOL attribute is a switch with its state in words ("Yes" / "No"). "Not
 * set" is a real third state on Google — the attribute simply isn't there —
 * so the row says "Not set" until a value is chosen, and `onClear` (when
 * given) offers "Clear" to take a value back off Google.
 */
export function TypedAttributeControl({
  metadata,
  attribute,
  disabled,
  onChange,
  onClear,
  changed = false,
}: {
  metadata: AttributeMetadata
  attribute: GoogleAttribute | undefined
  disabled: boolean
  onChange: (next: GoogleAttribute) => void
  /** Remove the value, so Google holds no answer for this attribute. */
  onClear?: (name: string) => void
  /** The draft differs from Google for this attribute. */
  changed?: boolean
}) {
  const labelId = useId()
  const name = metadata.parent
  const label = metadata.displayName ?? name
  const kind = attributeControlKind(metadata.valueType)
  const enumOptions = enumOptionsFor(metadata)

  const labelBlock = (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <span id={labelId} className="text-ui font-semibold text-ink">
        {label}
      </span>
      {changed ? <ChangedMark /> : null}
    </span>
  )

  const rowClass =
    "flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-2"

  if (kind === "bool") {
    const value = attribute?.values?.[0]
    const set = typeof value === "boolean"
    const checked = value === true
    return (
      <div className={rowClass}>
        {labelBlock}
        <span className="flex items-center gap-2">
          {set && onClear && !disabled ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-label={`Clear ${label}`}
              onClick={() => onClear(name)}
            >
              Clear
            </Button>
          ) : null}
          <span aria-hidden className="w-14 text-right text-ui text-ink-muted">
            {set ? (checked ? "Yes" : "No") : "Not set"}
          </span>
          <Switch
            checked={checked}
            disabled={disabled}
            aria-labelledby={labelId}
            aria-description={set ? undefined : "Not set on Google"}
            onCheckedChange={(next) =>
              onChange({ name, values: [next === true] })
            }
          />
        </span>
      </div>
    )
  }
  if (kind === "enum" && enumOptions.length > 0) {
    const current = attribute?.repeatedEnumValue?.setValues?.[0] ?? ""
    return (
      <div className={rowClass}>
        {labelBlock}
        <Select
          value={current}
          onValueChange={(value: string | null) =>
            onChange({
              name,
              repeatedEnumValue: { setValues: value ? [value] : [] },
            })
          }
          disabled={disabled}
        >
          <SelectTrigger aria-label={label} className="w-full sm:w-70">
            <SelectValue placeholder="Not set" />
          </SelectTrigger>
          <SelectContent>
            {enumOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }
  if (kind === "url") {
    const uri = attribute?.uriValues?.[0]?.uri ?? ""
    return (
      <div className={rowClass}>
        {labelBlock}
        <Input
          type="url"
          value={uri}
          disabled={disabled}
          inputMode="url"
          placeholder="https://…"
          aria-label={label}
          className="w-full sm:w-70"
          onChange={(event) =>
            onChange({
              name,
              uriValues: event.target.value
                ? [{ uri: event.target.value }]
                : [],
            })
          }
        />
      </div>
    )
  }
  return (
    <div className={rowClass}>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-ui font-semibold text-ink">{label}</span>
        <span className="text-caption text-ink-muted">
          Not editable here yet. Change it in Google directly.
        </span>
      </span>
      <StatusPill tone="outline" plain>
        Read only
      </StatusPill>
    </div>
  )
}
