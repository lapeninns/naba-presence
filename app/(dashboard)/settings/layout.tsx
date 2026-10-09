import { HydrationBoundary } from "@tanstack/react-query"

import { PageFrame } from "@/components/app-shell/page-frame"
import { prefetch, settingsPrefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

/**
 * Settings pages share one frame. Each page draws its own header with the
 * Policy · Connections tabs beneath the title (reference
 * `settings-subnav`), because the tabs sit under a title that changes per
 * page.
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  // settingsCapabilities is a pure role projection, so hydrating it here
  // costs nothing and saves every settings page its first request.
  const state = await prefetch(session, settingsPrefetch())
  return (
    <PageFrame width="standard">
      <HydrationBoundary state={state}>{children}</HydrationBoundary>
    </PageFrame>
  )
}
