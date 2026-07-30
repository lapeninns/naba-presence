import "server-only"

import { withTenant } from "@/lib/server/db"
import { getSession } from "@/lib/server/session"

export async function listLinkedLocationIds(): Promise<string[]> {
  const session = await getSession()
  if (!session) return []

  return withTenant(session.organisationId, async (sql) => {
    const rows = await sql<{ location_id: string }[]>`
      select l.id::text as location_id
      from location l
      join location_link ll
        on ll.location_id = l.id
       and ll.is_active = true
      order by l.name asc
    `
    return rows.map((row) => row.location_id)
  })
}
