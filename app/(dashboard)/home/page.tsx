import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { OverviewView } from "@/components/home/overview-view"

// The route stays /home; only the name changes. See the note on NAV_ITEMS in
// components/app-shell/nav.tsx.
export const metadata = { title: "Overview · NabaPresence" }

export default function HomePage() {
  return (
    <PageFrame width="wide">
      <PageHeader
        title="Overview"
        description="Open work waiting for you now, and how the last 30 days look on Google."
      />
      <OverviewView />
    </PageFrame>
  )
}
