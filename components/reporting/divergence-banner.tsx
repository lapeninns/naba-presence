import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { ProviderTotals } from "@/lib/api/analytics"

export type ReportAudience = "internal" | "public"

const COPY: Record<ReportAudience, string> = {
  internal:
    "Google reports a different review total or rating than we have collected so far, so the numbers below may be behind or missing some reviews. They will settle as syncing catches up.",
  // The client's reader has no sync to wait on and no "we": say what the
  // difference means for the figures, not how the agency's tooling works.
  public:
    "Google reports a different review total or rating than has been collected so far, so some recent reviews may not be counted yet.",
}

/**
 * Renders only when Google's own totals diverge from what has been ingested,
 * so the figures may be incomplete or stale. No raw numbers-as-code, no
 * jargon. `audience` picks the wording: the operator's report (internal) or
 * the client's shared report (public). The warning variant supplies its own
 * leading glyph.
 *
 * Pass `providerTotals` (the overview's) or `divergent` (the shared report's
 * `incomplete`, which carries no totals).
 */
export function DivergenceBanner({
  providerTotals,
  divergent,
  audience = "internal",
}: {
  providerTotals?: ProviderTotals
  divergent?: boolean
  audience?: ReportAudience
}) {
  if (!(divergent ?? providerTotals?.divergence)) return null
  return (
    <Alert variant="warning">
      <AlertTitle>These figures may be incomplete</AlertTitle>
      <AlertDescription>{COPY[audience]}</AlertDescription>
    </Alert>
  )
}
