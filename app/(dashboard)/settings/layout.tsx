import { HydrationBoundary } from "@tanstack/react-query"

import { PageFrame } from "@/components/app-shell/page-frame"
import { BillingScreensProvider } from "@/components/settings/billing-screens"
import { SettingsFeaturesProvider } from "@/components/settings/settings-features"
import { getServerEnv } from "@/lib/server/env"
import { isMfaEnabled } from "@/lib/server/mfa"
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
            {children}
          </BillingScreensProvider>
        </HydrationBoundary>
      </SettingsFeaturesProvider>
    </PageFrame>
  )
}
