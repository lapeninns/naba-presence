"use client"

import { RouteErrorState } from "@/components/ui/query-states"

// app/(dashboard)/settings/layout.tsx owns the <main> landmark and the
// settings nav; this boundary only replaces the page inside it.
export default function SettingsError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <RouteErrorState
      title="This settings page hit an error"
      description="Your other settings are unaffected and the rest of NabaPresence is still working. Try again, or go back to Home."
      onReset={reset}
    />
  )
}
