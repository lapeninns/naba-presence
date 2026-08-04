import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { AttentionList } from "@/components/home/attention-list"
import { DisconnectedBanner } from "@/components/home/disconnected-banner"
import { HomeCharts } from "@/components/home/home-charts"
import { KpiCards } from "@/components/home/kpi-cards"

// The route stays /home; only the name changes. See the note on NAV_ITEMS in
// components/app-shell/nav.tsx.
export const metadata = { title: "Overview · NabaPresence" }

export default function HomePage() {
  return (
    <PageFrame width="wide">
      <PageHeader
        title="Overview"
        description="How your business is doing on Google, over the last 30 days."
      />
      <DisconnectedBanner />
      <KpiCards />
      <HomeCharts />
      <AttentionList />
    </PageFrame>
  )
}
