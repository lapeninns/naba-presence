import { PageFrame } from "@/components/app-shell/page-frame"
import { NotificationsView } from "@/components/notifications/notifications-view"

export const metadata = { title: "Notifications · NabaPresence" }

export default function NotificationsPage() {
  return (
    <PageFrame>
      <NotificationsView />
    </PageFrame>
  )
}
