import "server-only"

import type { TransactionSql } from "postgres"

import { ApiError } from "@/lib/server/http"

/**
 * What `GET /api/settings` answers under `settings`: the organisation's
 * reply policy, retention and defaults. Shared with the Reply policy
 * prefetch (lib/server/prefetch.ts) so the hydrated form and a refetch are
 * read the same way. 404 `organisation_not_found` if the row is gone.
 */
export async function loadOrgSettings(
  sql: TransactionSql,
  organisationId: string
) {
  const [row] = await sql`
    select
      approval_required as "approvalRequired",
      require_two_person_approval as "requireTwoPersonApproval",
      raw_content_retention_days as "rawContentRetentionDays",
      default_language_code as "defaultLanguageCode",
      default_timezone as "defaultTimezone",
      direct_publish_consent_at as "directPublishConsentAt"
    from organisation
    where id = ${organisationId}
  `
  if (!row) {
    throw new ApiError(404, "organisation_not_found", "Organisation not found.")
  }
  return row
}
