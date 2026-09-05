"use client"

import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  AttributeMetadata,
  GoogleAttribute,
} from "@/lib/api/location-business-information"
import { attributeControlKind } from "@/lib/locations/console-labels"
import { enumOptionsFor } from "@/lib/locations/google-values"

// Renders a single typed Google attribute control from its metadata. Only the
// well-understood value types get an editor; anything else is read-only with the
// §12 pressure-valve note — never a JSON escape hatch (§8).
//
// A BOOL attribute stays a checkbox rather than a switch: these are facts
// about the business ("Wi-Fi", "Wheelchair access") ticked in a long form, not
// settings that take effect on their own, and a column of them is a checklist.
export function TypedAttributeControl({
  metadata,
  attribute,
  disabled,
  onChange,
}: {
  metadata: AttributeMetadata
  attribute: GoogleAttribute | undefined
  disabled: boolean
  onChange: (next: GoogleAttribute) => void
}) {
  const name = metadata.parent
  const label = metadata.displayName ?? name
  const kind = attributeControlKind(metadata.valueType)
  const enumOptions = enumOptionsFor(metadata)

  if (kind === "bool") {
    const checked = attribute?.values?.[0] === true
    return (
      // Base UI's Checkbox auto-wires aria-labelledby to a wrapping native
      // <label> — no separate aria-label needed here (see components/ui/checkbox.tsx).
      <label className="flex min-h-6 items-center gap-2 text-ui text-ink">
        <Checkbox
          checked={checked}
          disabled={disabled}
          onCheckedChange={(next) =>
            onChange({ name, values: [next === true] })
          }
        />
        <span>{label}</span>
      </label>
    )
  }
  if (kind === "enum" && enumOptions.length > 0) {
    const current = attribute?.repeatedEnumValue?.setValues?.[0] ?? ""
    return (
      <label className="flex flex-col gap-1.5 text-ui font-medium text-ink">
        <span>{label}</span>
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
          <SelectTrigger aria-label={label} className="w-full font-normal">
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
      </label>
    )
  }
  if (kind === "url") {
    const uri = attribute?.uriValues?.[0]?.uri ?? ""
    return (
      <label className="flex flex-col gap-1.5 text-ui font-medium text-ink">
        <span>{label}</span>
        <Input
          value={uri}
          disabled={disabled}
          inputMode="url"
          aria-label={label}
          className="font-normal"
          onChange={(event) =>
            onChange({
              name,
              uriValues: event.target.value
                ? [{ uri: event.target.value }]
                : [],
            })
          }
        />
      </label>
    )
  }
  return (
    <div className="flex flex-col gap-0.5 text-ui">
      <span className="font-medium text-ink">{label}</span>
      <span className="text-caption text-ink-muted">
        Not editable here yet.
      </span>
    </div>
  )
}
