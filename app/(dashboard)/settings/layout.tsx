import { HydrationBoundary } from "@tanstack/react-query"

import { SettingsNav } from "@/components/settings/settings-nav"
import { PageFrame } from "@/components/app-shell/page-frame"
import { prefetch, settingsPrefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  // settingsCapabilities is a pure role projection, so hydrating it here
  // costs nothing and saves every settings page its first request.
  const state = await prefetch(session, settingsPrefetch())
  return (
    <PageFrame width="standard">
      <SettingsNav role={session?.role ?? null} />
      <HydrationBoundary state={state}>{children}</HydrationBoundary>
    </PageFrame>
  )
}
