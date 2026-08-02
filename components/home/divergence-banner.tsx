import { TriangleAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { ProviderTotals } from "@/lib/api/analytics"

// Renders only when Google's own totals diverge from what we have ingested, so
// the figures may be incomplete or stale. No raw numbers-as-code, no jargon.
export function DivergenceBanner({ providerTotals }: { providerTotals: ProviderTotals }) {
  if (!providerTotals.divergence) return null
  return (
    <Alert variant="warning">
      <TriangleAlertIcon aria-hidden />
      <AlertTitle>These figures may be incomplete</AlertTitle>
      <AlertDescription>
        Google reports a different review total or rating than we have collected so far, so the numbers
        below may be behind or missing some reviews. They will settle as syncing catches up.
      </AlertDescription>
    </Alert>
  )
}
