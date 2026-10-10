import "server-only"

import type { TransactionSql } from "postgres"

/**
 * Per-organisation product flags (organisation_feature, migration 0071).
 *
 * A feature an organisation has no row for is off: new work ships dark and
 * is switched on per organisation from the operator connection. This is a
 * product switch, not a kill switch; the global stop for the same work is
 * its pause scope (lib/server/pause-controls.ts), and a paused scope stops
 * the work even for an organisation that has the feature on.
 *
 * Known features are listed here so a typo is a type error rather than a
 * feature that is silently never on; the table accepts any snake_case name,
 * so a slice adding a feature adds it here only.
 */
export const ORG_FEATURES = [
  // One-time scheduled posts (plan P08).
  "post_scheduling",
  // Bulk listing and review actions (plan P09).
  "bulk_actions",
] as const

export type OrgFeature = (typeof ORG_FEATURES)[number]

/**
 * Whether `feature` is on for the organisation. Runs inside that
 * organisation's tenant transaction (withTenant), so RLS already scopes the
 * read; the explicit filter keeps the query correct even outside it.
 */
export async function isOrgFeatureEnabled(
  sql: TransactionSql,
  organisationId: string,
  feature: OrgFeature
): Promise<boolean> {
  const [row] = await sql<{ enabled: boolean }[]>`
    select enabled
    from organisation_feature
    where organisation_id = ${organisationId}
      and feature = ${feature}
  `
  return row?.enabled ?? false
}
