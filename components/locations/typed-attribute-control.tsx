"use client"

import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { AttributeMetadata, GoogleAttribute } from "@/lib/api/location-business-information"
import { attributeControlKind } from "@/lib/locations/console-labels"

// Renders a single typed Google attribute control from its metadata. Only the
// well-understood value types get an editor; anything else is read-only with the
// §12 pressure-valve note — never a JSON escape hatch (§8).
export function TypedAttributeControl({
  metadata, attribute, disabled, onChange,
}: {
  metadata: AttributeMetadata
  attribute: GoogleAttribute | undefined
  disabled: boolean
  onChange: (next: GoogleAttribute) => void
}) {
  const name = metadata.parent
  const label = metadata.displayName ?? name
  const kind = attributeControlKind(metadata.valueType)
  const enumOptions = extractEnumOptions(metadata)

  if (kind === "bool") {
    const checked = attribute?.values?.[0] === true
    return (
      // Base UI's Checkbox auto-wires aria-labelledby to a wrapping native
      // <label> — no separate aria-label needed here (see components/ui/checkbox.tsx).
      <label className="flex items-center gap-2 text-ui">
        <Checkbox checked={checked} disabled={disabled} onCheckedChange={(next) => onChange({ name, values: [next === true] })} />
        <span>{label}</span>
      </label>
    )
  }
  if (kind === "enum" && enumOptions.length > 0) {
    const current = attribute?.repeatedEnumValue?.setValues?.[0] ?? ""
    return (
      <label className="flex flex-col gap-1 text-ui">
        <span>{label}</span>
        <Select
          value={current}
          onValueChange={(value: string | null) => onChange({ name, repeatedEnumValue: { setValues: value ? [value] : [] } })}
          disabled={disabled}
        >
          <SelectTrigger aria-label={label}><SelectValue placeholder="Not set" /></SelectTrigger>
          <SelectContent>
            {enumOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </label>
    )
  }
  if (kind === "url") {
    const uri = attribute?.uriValues?.[0]?.uri ?? ""
    return (
      <label className="flex flex-col gap-1 text-ui">
        <span>{label}</span>
        <Input value={uri} disabled={disabled} inputMode="url" aria-label={label} onChange={(event) => onChange({ name, uriValues: event.target.value ? [{ uri: event.target.value }] : [] })} />
      </label>
    )
  }
  return (
    <div className="flex flex-col gap-0.5 text-ui">
      <span className="font-medium">{label}</span>
      <span className="text-caption text-muted-foreground">Not editable here yet.</span>
    </div>
  )
}

function extractEnumOptions(metadata: AttributeMetadata): Array<{ value: string; label: string }> {
  const meta = metadata as unknown as { valueMetadata?: Array<{ value?: string; displayName?: string }> }
  return (meta.valueMetadata ?? [])
    .filter((entry): entry is { value: string; displayName?: string } => typeof entry.value === "string")
    .map((entry) => ({ value: entry.value, label: entry.displayName ?? entry.value }))
}
