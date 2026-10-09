import { route } from "@/lib/server/route"

export const runtime = "nodejs"

type IncidentRow = {
  id: string
  kind: string
  subjectType: string
  subjectId: string
  status: "open" | "resolved"
  summary: Record<string, unknown>
  openedAt: Date
  resolvedAt: Date | null
}

/**
 * The organisation's operational incidents (0050): everything open, and
 * what resolved in the last week. Owners and admins only -- these name
 * connected logins and listings -- and read through RLS, so another
 * tenant's incidents are invisible whatever the request says.
 */
export const GET = route({
  roles: ["owner", "admin"],
  handler: async ({ tenant }) => {
    const rows = await tenant(
      (sql) => sql<IncidentRow[]>`
        select
          id::text as id,
          kind,
          subject_type as "subjectType",
          subject_id as "subjectId",
          status,
          summary,
          opened_at as "openedAt",
          resolved_at as "resolvedAt"
        from notification_incident
        where status = 'open'
           or opened_at >= now() - interval '7 days'
        order by status = 'open' desc, opened_at desc
        limit 200
      `
    )
    return {
      incidents: rows.map((row) => ({
        ...row,
        openedAt: row.openedAt.toISOString(),
        resolvedAt: row.resolvedAt?.toISOString() ?? null,
      })),
    }
  },
})
