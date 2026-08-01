import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { AttentionList } from "@/components/home/attention-list"
import { DisconnectedBanner } from "@/components/home/disconnected-banner"
import { KpiCards } from "@/components/home/kpi-cards"

export const metadata = { title: "Home · NabaPresence" }

export default function HomePage() {
  return (
    <PageFrame width="wide">
      <PageHeader
        title="Home"
        description="Your Google presence across every connected location, for the last 30 days."
      />
      <DisconnectedBanner />
      <KpiCards />
      <AttentionList />
    </PageFrame>
  )
}
