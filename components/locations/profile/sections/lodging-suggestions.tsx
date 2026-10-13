"use client"

import { Button } from "@/components/ui/button"
import { Fieldset, FieldsetLegend } from "@/components/ui/fieldset"
import { lodgingEditorCoverage } from "@/lib/locations/forms/lodging-catalogue"
import { acceptLodgingSuggestion, lodgingSuggestions } from "@/lib/locations/forms/lodging-suggestions"
import { LodgingFieldControl } from "./lodging-field-control"
import { RowList, SettingsGroupLabel } from "./setting-rows"

const coverage = lodgingEditorCoverage()
export function LodgingSuggestions({ value, response, error, disabled, onChange }: {
  readonly value: unknown; readonly response: unknown; readonly error: string | null
  readonly disabled: boolean; readonly onChange: (draft: Record<string, unknown>) => void
}) {
  const suggestions = lodgingSuggestions(value, response)
  if (error || !suggestions.readable) return <p role="status" className="text-ui text-ink-muted">Google suggested lodging updates could not be read. Your current draft is preserved; refresh to check again.</p>
  if (suggestions.rows.length === 0 && suggestions.unsupportedPaths.length === 0) return <p className="text-ui text-ink-muted">Google has not suggested lodging changes.</p>
  return <section aria-label="Suggested lodging changes" className="flex min-w-0 flex-col gap-3">
    <div className="flex flex-col gap-1"><SettingsGroupLabel as="h4">Google suggested lodging changes</SettingsGroupLabel><p className="text-caption text-ink-muted">Compare each detail. Applying a suggestion changes only your draft; it does not send anything to Google.</p></div>
    {suggestions.unsupportedPaths.length ? <p className="text-caption text-ink-muted">Some suggested fields are unsupported here and are preserved for review in Google.</p> : null}
    {suggestions.rows.length ? <RowList>{suggestions.rows.map((row) => {
      const node = coverage.get(row.path)
      if (!node) return null
      return <li key={row.path} className="flex min-w-0 flex-col gap-3 py-4">
        <h5 className="text-body font-semibold text-ink">{row.label}</h5>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Fieldset className="gap-2"><FieldsetLegend variant="muted">Current draft</FieldsetLegend><LodgingFieldControl node={node} value={row.current} original={row.current} disabled errors={{}} onChange={() => undefined} /></Fieldset>
          <Fieldset className="gap-2"><FieldsetLegend variant="muted">Google suggestion</FieldsetLegend><LodgingFieldControl node={node} value={row.suggested} original={row.suggested} disabled errors={{}} onChange={() => undefined} /></Fieldset>
        </div>
        <Button type="button" size="sm" variant="secondary" className="self-start" disabled={disabled} onClick={() => onChange(acceptLodgingSuggestion(value, row))}>Apply suggested {row.label.toLowerCase()} to draft</Button>
      </li>
    })}</RowList> : null}
  </section>
}
