import "server-only"

import { withTenant } from "@/lib/server/db"
import { isOrgFeatureEnabled } from "@/lib/server/org-features"
import { getSession } from "@/lib/server/session"

export type CalendarContext = {
  /**
   * Whether the organisation's `post_scheduling` feature is on; `null` when
   * it could not be read, and the occurrences route answers instead.
   */
  scheduling: boolean | null
  /** The organisation's default IANA timezone, for "today"; null if unread. */
  timeZone: string | null
}

/**
 * What the calendar page knows before the first request: whether scheduled
 * publishing is on (so a workspace without it never fires the occurrences
 * route's 404) and the organisation's timezone (so "today" is the
 * workspace's date, not the server's or UTC). A failed read is not an
 * answer: the client falls back to asking the route.
 */
export async function readCalendarContext(): Promise<CalendarContext> {
  const session = await getSession()
  if (!session) return { scheduling: null, timeZone: null }
  try {
    return await withTenant(session.organisationId, async (sql) => {
      const scheduling = await isOrgFeatureEnabled(
        sql,
        session.organisationId,
        "post_scheduling"
      )
      const [row] = await sql<{ timeZone: string | null }[]>`
        select default_timezone as "timeZone"
        from organisation
        where id = ${session.organisationId}
      `
      return { scheduling, timeZone: row?.timeZone ?? null }
    })
  } catch {
    return { scheduling: null, timeZone: null }
  }
}
