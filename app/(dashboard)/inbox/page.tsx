import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { InboxView } from "@/components/inbox/inbox-view"

export const metadata = { title: "Inbox · NabaPresence" }

export default function InboxPage() {
  return (
    <PageFrame width="workspace" className="min-h-0 flex-1">
      <PageHeader
        title="Inbox"
        description="Every Google review across your connected locations, in one queue."
      />
      <InboxView />
    </PageFrame>
  )
}
