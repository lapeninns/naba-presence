import { HydrationBoundary } from "@/lib/queries/hydration-boundary"

import { PageFrame } from "@/components/app-shell/page-frame"
import { BillingScreensProvider } from "@/components/settings/billing-screens"
import { SettingsFeaturesProvider } from "@/components/settings/settings-features"
import { SettingsSectionList } from "@/components/settings/settings-section-list"
import { getServerEnv } from "@/lib/server/env"
import { isMfaEnabled } from "@/lib/server/mfa"
import { prefetch, settingsPrefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

/**
 * Settings pages share one frame. From md it has two panes (DIRECTION
 * §7.4): the section list, sticky under the toolbar, and the page, which
 * draws its own header. On a phone there is one pane, and /settings is an
 * index of the areas instead (components/settings/settings-index.tsx).
 *
 * The content pane is its own `@container`, so a page's sections answer to
 * the room beside the list rather than to the whole frame. The loading and
 * error states render inside it, so the list stays as the way round.
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  // settingsCapabilities is a role projection plus the organisation's
  // settings feature switches (one tenant read for an owner or admin, none
  // for anyone else). Hydrating it here saves every settings page its first
  // request.
  const state = await prefetch(session, settingsPrefetch())
  return (
    <PageFrame width="standard">
      <SettingsFeaturesProvider value={{ mfa: isMfaEnabled() }}>
        <HydrationBoundary state={state}>
          <BillingScreensProvider enabled={getServerEnv().BILLING_ENABLED}>
            <div
              data-slot="settings-panes"
              className="md:flex md:items-start md:gap-6"
            >
              <SettingsSectionList
                role={session?.role ?? null}
                // Sticky only where the whole list fits under the toolbar; a
                // short landscape window scrolls it with the page instead.
                className="md:-ml-2.5 md:w-57.5 md:shrink-0 print:hidden md:tall:sticky md:tall:top-[calc(var(--np-toolbar-h)+var(--np-page-pad-y))]"
              />
              <div className="@container flex min-w-0 flex-1 flex-col gap-(--np-gap-section)">
                {children}
              </div>
            </div>
          </BillingScreensProvider>
        </HydrationBoundary>
      </SettingsFeaturesProvider>
    </PageFrame>
  )
}
