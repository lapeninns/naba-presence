"use client"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { LODGING_FIELD_GUIDANCE, lodgingFieldLabel, type LodgingEditorNode } from "@/lib/locations/forms/lodging-catalogue"

type Scalar = Exclude<LodgingEditorNode, { readonly kind: "group" | "array" | "time" }>
const exceptionLabels: Readonly<Record<string, string>> = {
  EXCEPTION_UNSPECIFIED: "No exception specified", UNDER_CONSTRUCTION: "Under construction",
  DEPENDENT_ON_SEASON: "Depends on season", DEPENDENT_ON_DAY_OF_WEEK: "Depends on day of week",
}
const label = (value: string) => exceptionLabels[value] ?? lodgingFieldLabel(value)

export function LodgingScalarControl({ node, value, original, disabled, error, added = false, onChange }: {
  readonly node: Scalar; readonly value: unknown; readonly original: unknown
  readonly disabled: boolean; readonly error?: string
  /** The detail belongs to a collection item added in this draft, so Google has no value to report. */
  readonly added?: boolean
  readonly onChange: (value: unknown) => void
}) {
  const hint = LODGING_FIELD_GUIDANCE[node.path]?.hint
  const dirty = JSON.stringify(value) !== JSON.stringify(original)
  const choices = node.kind === "boolean" ? ["true", "false"] : node.kind === "enum" ? node.values : null
  const selected = node.kind === "boolean" ? typeof value === "boolean" ? String(value) : "unknown" : typeof value === "string" ? value : "unknown"
  const known = value === undefined || (node.kind === "boolean" ? typeof value === "boolean" : choices ? typeof value === "string" && choices.includes(value) : node.kind === "text" ? typeof value === "string" : typeof value === "number")
  return <Field error={error}>
    <FieldLabel>{node.label}</FieldLabel>
    {choices ? <Select value={selected} disabled={disabled} onValueChange={(next: string | null) => {
      if (!next || next === "unknown") return
      onChange(node.kind === "boolean" ? next === "true" : next)
    }}>
      <SelectTrigger className="w-full"><SelectValue>{(current: string | null) => current === "unknown" ? "Not recorded" : node.kind === "boolean" ? current === "true" ? "Yes" : "No" : current ? label(current) : "Not recorded"}</SelectValue></SelectTrigger>
      <SelectContent>
        <SelectItem value="unknown" disabled>Not recorded</SelectItem>
        {choices.map((choice) => <SelectItem key={choice} value={choice}>{node.kind === "boolean" ? choice === "true" ? "Yes" : "No" : label(choice)}</SelectItem>)}
      </SelectContent>
    </Select> : <Input
      type={node.kind === "text" ? "text" : "number"}
      step={node.kind === "integer" ? 1 : node.kind === "number" ? "any" : undefined}
      value={typeof value === "string" || typeof value === "number" ? value : ""}
      placeholder={added ? undefined : "Not recorded"} disabled={disabled}
      onChange={(event) => onChange(event.target.value === "" ? undefined : node.kind === "text" ? event.target.value : Number(event.target.value))}
    />}
    {!known ? <FieldDescription>Google supplied an unsupported value. It is preserved until you choose a supported value.</FieldDescription>
      : hint ? <FieldDescription>{hint}</FieldDescription>
      : value === undefined && !error ? <FieldDescription>{added ? "Not set yet." : "Google has not recorded a value for this detail."}</FieldDescription> : null}
    <FieldError />
    {dirty ? <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(original)}>Reset {node.label.toLowerCase()}</Button> : null}
  </Field>
}
