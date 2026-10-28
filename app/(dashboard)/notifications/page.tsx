import { PageFrame } from "@/components/app-shell/page-frame"
import { NotificationsView } from "@/components/notifications/notifications-view"
import { getServerEnv } from "@/lib/server/env"
import { usageSettingsPath } from "@/lib/server/notifications/messages"

export const metadata = { title: "Notifications · NabaPresence" }

export default function NotificationsPage() {
  return (
    <PageFrame>
      {/* AI credits live where the email sends people: Usage with billing
          on, Reply policy without. */}
      <NotificationsView
        usageHref={usageSettingsPath(getServerEnv().BILLING_ENABLED)}
      />
    </PageFrame>
  )
}
