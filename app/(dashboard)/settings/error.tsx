"use client"

import { BoundaryErrorState } from "@/components/app-shell/boundary"

// app/(dashboard)/settings/layout.tsx owns the <main> landmark; this boundary
// only replaces the page (its header and tabs included) inside it. Light
// helpers only (components/app-shell/boundary.tsx): this file is its own chunk.
export default function SettingsError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <BoundaryErrorState
      title="This settings page hit an error"
      description="Your other settings are unaffected and the rest of NabaPresence is still working. Try again, or go back to the Inbox."
      onReset={reset}
    />
  )
}
