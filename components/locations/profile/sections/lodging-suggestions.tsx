"use client"

import { Button } from "@/components/ui/button"
import { lodgingEditorCoverage } from "@/lib/locations/forms/lodging-catalogue"
import { acceptLodgingSuggestion, lodgingSuggestions } from "@/lib/locations/forms/lodging-suggestions"
import { LodgingFieldControl } from "./lodging-field-control"

const coverage = lodgingEditorCoverage()
export function LodgingSuggestions({ value, response, error, disabled, onChange }: {
  readonly value: unknown; readonly response: unknown; readonly error: string | null
  readonly disabled: boolean; readonly onChange: (draft: Record<string, unknown>) => void
}) {
  const suggestions = lodgingSuggestions(value, response)
  if (error || !suggestions.readable) return <p role="status" className="text-ui text-ink-muted">Google suggested lodging updates could not be read. Your current draft is preserved; refresh to check again.</p>
  if (suggestions.rows.length === 0 && suggestions.unsupportedPaths.length === 0) return <p className="text-ui text-ink-muted">Google has not suggested lodging changes.</p>
  return <section aria-label="Suggested lodging changes" className="flex min-w-0 flex-col gap-4">
    <div className="flex flex-col gap-1"><h4 className="text-title font-semibold text-ink">Google suggested lodging changes</h4><p className="text-ui text-ink-muted">Compare each detail. Applying a suggestion changes only your draft; it does not send anything to Google.</p></div>
    {suggestions.unsupportedPaths.length ? <p className="text-ui text-ink-muted">Some suggested fields are unsupported here and are preserved for review in Google.</p> : null}
    {suggestions.rows.map((row) => {
      const node = coverage.get(row.path)
      if (!node) return null
      return <div key={row.path} className="flex min-w-0 flex-col gap-3 rounded-(--np-radius-card) border border-line bg-surface p-4">
        <h5 className="text-ui font-semibold text-ink">{row.label}</h5>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <fieldset className="min-w-0"><legend className="mb-2 text-ui text-ink-muted">Current draft</legend><LodgingFieldControl node={node} value={row.current} original={row.current} disabled errors={{}} onChange={() => undefined} /></fieldset>
          <fieldset className="min-w-0"><legend className="mb-2 text-ui text-ink-muted">Google suggestion</legend><LodgingFieldControl node={node} value={row.suggested} original={row.suggested} disabled errors={{}} onChange={() => undefined} /></fieldset>
        </div>
        <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => onChange(acceptLodgingSuggestion(value, row))}>Apply suggested {row.label.toLowerCase()} to draft</Button>
      </div>
    })}
  </section>
}
