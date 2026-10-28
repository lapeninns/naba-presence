import { HydrationBoundary } from "@/lib/queries/hydration-boundary"

import { PageHeader } from "@/components/app-shell/page-frame"
import { NotificationPreferences } from "@/components/settings/notification-preferences"
import { SettingsNav } from "@/components/settings/settings-nav"
import { notificationSettingsPrefetch, prefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Notifications · NabaPresence" }

export default async function SettingsNotificationsPage() {
  const session = await getSession()
  // The choices are pure SQL: read them here so the rows are in the first
  // HTML instead of a skeleton.
  const state = await prefetch(session, notificationSettingsPrefetch())
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Choose what you hear about in the app and by email."
        tabs={<SettingsNav role={session?.role ?? null} />}
      />
      <HydrationBoundary state={state}>
        <NotificationPreferences role={session?.role ?? null} />
      </HydrationBoundary>
    </>
  )
}
