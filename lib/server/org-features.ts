import "server-only"

import type { TransactionSql } from "postgres"

import type { OrgFeature } from "@/lib/contracts/org-features"

/**
 * Per-organisation product flags (organisation_feature, migration 0090).
 *
 * A feature an organisation has no row for is off: new work ships dark and
 * is switched on per organisation from the operator connection. This is a
 * product switch, not a kill switch; the global stop for the same work is
 * its pause scope (lib/server/pause-controls.ts), and a paused scope stops
 * the work even for an organisation that has the feature on.
 *
 * Known features live in lib/contracts/org-features.ts, so a typo is a type
 * error here and a refusal in scripts/ops-pause.mjs.
 */
export { ORG_FEATURES, type OrgFeature } from "@/lib/contracts/org-features"

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
