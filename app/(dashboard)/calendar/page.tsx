import { PageFrame } from "@/components/app-shell/page-frame"
import { PublicationCalendar } from "@/components/calendar/publication-calendar"
import { readCalendarContext } from "@/lib/calendar/calendar-context"

export const metadata = { title: "Publication calendar · NabaPresence" }

export default async function CalendarPage() {
  const { scheduling, timeZone } = await readCalendarContext()
  return (
    <PageFrame>
      <PublicationCalendar
        scheduling={scheduling}
        timeZone={timeZone ?? undefined}
      />
    </PageFrame>
  )
}
