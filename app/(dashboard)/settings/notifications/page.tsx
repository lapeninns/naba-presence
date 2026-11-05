import { HydrationBoundary } from "@/lib/queries/hydration-boundary"

import { PageHeader } from "@/components/app-shell/page-frame"
import { NotificationPreferences } from "@/components/settings/notification-preferences"
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
      />
      {/* The groups' own top margin (first:mt-0) spaces them apart; as
          siblings of the header they would add it to the pane's gap too. */}
      <div className="flex flex-col">
        <HydrationBoundary state={state}>
          <NotificationPreferences role={session?.role ?? null} />
        </HydrationBoundary>
      </div>
    </>
  )
}
