"use client"

import { usePathname } from "next/navigation"

import { BoundaryErrorState } from "@/components/app-shell/boundary"

// app/(dashboard)/settings/layout.tsx owns the <main> landmark; this boundary
// only replaces the page (its header and tabs included) inside it. Light
// helpers only (components/app-shell/boundary.tsx): this file is its own chunk.
//
// On a settings area the way out goes up to Settings, like the app bar's
// "‹ Settings", the 404 and access denied: the tabs (desk) and the index
// (phone) come back, and the path change resets this boundary. On /settings
// itself that link would only reload the error, so it keeps the Inbox.
export default function SettingsError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const pathname = usePathname()
  const inSection = pathname !== null && pathname !== "/settings"
  return (
    <BoundaryErrorState
      title="This settings page hit an error"
      description={
        inSection
          ? "Your other settings are unaffected and the rest of NabaPresence is still working. Try again, or go back to Settings."
          : "Your other settings are unaffected and the rest of NabaPresence is still working. Try again, or go back to the Inbox."
      }
      onReset={reset}
      homeHref={inSection ? "/settings" : "/inbox"}
      homeLabel={inSection ? "Back to Settings" : "Go to Inbox"}
    />
  )
}
