import { HydrationBoundary } from "@tanstack/react-query"

import { SettingsNav } from "@/components/settings/settings-nav"
import { PageFrame } from "@/components/app-shell/page-frame"
import { prefetch, settingsPrefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

/**
 * Settings in the System Settings shape: a sidebar of areas on the left and
 * the chosen pane on the right. The sidebar stays put while a long pane
 * scrolls beneath the toolbar; on narrow screens it becomes a strip above.
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
      <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
        <SettingsNav
          role={session?.role ?? null}
          className="lg:sticky lg:top-[calc(var(--np-toolbar-h)+var(--np-page-pad-y))] lg:w-52 lg:shrink-0 lg:self-start"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-(--np-gap-section)">
          <HydrationBoundary state={state}>{children}</HydrationBoundary>
        </div>
      </div>
    </PageFrame>
  )
}
