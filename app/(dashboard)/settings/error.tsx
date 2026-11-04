"use client"

import { usePathname } from "next/navigation"

import { BoundaryErrorState } from "@/components/app-shell/boundary"

// The shell owns the <main> landmark and app/(dashboard)/settings/layout.tsx
// the frame; this boundary only replaces the page in the content pane, so
// from md the section list stays beside it. Light helpers only
// (components/app-shell/boundary.tsx): this file is its own chunk.
//
// On a settings area the way out goes up to Settings, like the app bar's
// "‹ Settings", the 404 and access denied: the index (phone) comes back, and
// the path change resets this boundary. On /settings itself that link would
// only reload the error, so it keeps the Inbox.
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
      description="Nothing was changed. Your settings are safe."
      onReset={reset}
      homeHref={inSection ? "/settings" : "/inbox"}
      homeLabel={inSection ? "Back to Settings" : "Go to Inbox"}
    />
  )
}
