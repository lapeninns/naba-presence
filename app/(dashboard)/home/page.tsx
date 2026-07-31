import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"

export const metadata = { title: "Home · NabaPresence" }

export default function HomePage() {
  return (
    <PageFrame>
      <PageHeader
        title="Home"
        description="Google presence across every connected location."
      />
      <p className="text-ui text-muted-foreground">
        The Home roll-up returns in Milestone 3 of the rebuild.
      </p>
    </PageFrame>
  )
}
