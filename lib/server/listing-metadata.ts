import "server-only"

import type { Metadata } from "next"
import { cache } from "react"

import { withTenant } from "@/lib/server/db"
import { visibilityPredicate } from "@/lib/server/permissions"
import { getSession } from "@/lib/server/session"

/**
 * The listing's name, for the document title only: one indexed row, scoped
 * by the same visibility rule as the directory, once per request (React
 * `cache`), and never a Google call. Null when there is no session, the id
 * isn't visible, or the database can't answer — the title then falls back
 * to the generic one rather than failing the page.
 */
const readListingName = cache(
  async (locationId: string): Promise<string | null> => {
    const session = await getSession()
    if (!session) return null
    try {
      const [row] = await withTenant(
        session.organisationId,
        (sql) => sql<{ name: string }[]>`
          select l.name
          from location l
          where l.id::text = ${locationId}
            and ${visibilityPredicate(sql, session, sql`l.id`)}
          limit 1
        `
      )
      return row?.name ?? null
    } catch {
      return null
    }
  }
)

/**
 * "Opening hours · The Old Crown · NabaPresence": which venue a tab is on,
 * so a row of listing tabs in the browser can be told apart. `area` is the
 * page's own name; omit it for the listing's overview.
 */
export async function listingPageMetadata(
  params: Promise<{ id: string }>,
  area?: string
): Promise<Metadata> {
  const { id } = await params
  const name = await readListingName(id)
  const parts = [area, name ?? "Listing", "NabaPresence"].filter(Boolean)
  return { title: parts.join(" · ") }
}
