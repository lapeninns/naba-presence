import { PageFrame } from "@/components/app-shell/page-frame"
import { PublicationCalendar } from "@/components/calendar/publication-calendar"

export const metadata = { title: "Publication calendar · NabaPresence" }

export default function CalendarPage() {
  return (
    <PageFrame>
      <PublicationCalendar />
    </PageFrame>
  )
}
