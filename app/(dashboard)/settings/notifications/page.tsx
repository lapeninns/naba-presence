import { PageHeader } from "@/components/app-shell/page-frame"
import { NotificationPreferences } from "@/components/settings/notification-preferences"
import { SettingsNav } from "@/components/settings/settings-nav"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Notifications · NabaPresence" }

export default async function SettingsNotificationsPage() {
  const session = await getSession()
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Choose what you hear about in the app and by email. A daily summary collects the updates you choose for it into one email."
        tabs={<SettingsNav role={session?.role ?? null} />}
      />
      <NotificationPreferences />
    </>
  )
}
