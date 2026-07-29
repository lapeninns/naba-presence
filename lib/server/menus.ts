import "server-only"

import type { MenuContent, PublicMenu } from "@/lib/domain/menu"
import { getDatabase, withTenant } from "@/lib/server/db"

type PublicMenuRow = {
  publicSlug: string
  name: string
  locationName: string
  currencyCode: string | null
  version: number
  updatedAt: Date
  content: MenuContent
}

export async function getPublicMenuBySlug(
  slug: string
): Promise<PublicMenu | null> {
  const [route] = await getDatabase()<
    { organisationId: string; menuId: string }[]
  >`
    select
      organisation_id::text as "organisationId",
      menu_id::text as "menuId"
    from public_menu_route
    where public_slug = ${slug}
    limit 1
  `
  if (!route) return null

  const row = await withTenant(route.organisationId, async (sql) => {
    const [menu] = await sql<PublicMenuRow[]>`
      select
        m.public_slug as "publicSlug",
        m.name,
        l.name as "locationName",
        m.currency_code as "currencyCode",
        m.version,
        m.updated_at as "updatedAt",
        m.content_json as content
      from menu m
      join location l on l.id = m.location_id
      where m.id = ${route.menuId}
        and m.is_published = true
      limit 1
    `
    return menu ?? null
  })
  if (!row) return null

  return {
    slug: row.publicSlug,
    name: row.name,
    locationName: row.locationName,
    currencyCode: row.currencyCode,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    content: row.content,
  }
}
