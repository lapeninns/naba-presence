import "server-only"

import type { TransactionSql } from "postgres"

import type {
  ReportShare,
  ReportShareStatus,
} from "@/lib/contracts/report-shares"
import { randomToken, sha256 } from "@/lib/server/crypto"
import { getDatabase, withTenant } from "@/lib/server/db"
import { log } from "@/lib/server/logger"

/**
 * Client report share links: the token, its lookup and the view counter.
 *
 * A link is `/share/report/<token>`. The token is 32 random bytes as
 * base64url (43 characters), shown once when the link is created; only its
 * SHA-256 is stored (report_share.token_hash, migration 0057). Resolving a
 * token goes through lookup_report_share(), which answers only for a live
 * link, so an unknown, a revoked and an expired token look the same to the
 * caller -- and the public page shows one identical not-found for all three.
 */

export const REPORT_SHARE_TOKEN_BYTES = 32
/** base64url of 32 bytes, unpadded. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export const REPORT_SHARE_PATH = "/share/report/"

export function createReportShareToken(): { token: string; tokenHash: string } {
  const token = randomToken(REPORT_SHARE_TOKEN_BYTES)
  return { token, tokenHash: sha256(token) }
}

/**
 * Whether a string could be a token at all. Anything else is refused before
 * it costs a database round trip; the answer is the same not-found either
 * way, so this reveals nothing.
 */
export function isWellFormedReportShareToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_PATTERN.test(token)
}

export function reportShareUrl(token: string, baseUrl: string): string {
  return new URL(`${REPORT_SHARE_PATH}${token}`, baseUrl).toString()
}

/** A live link, as far as the public page needs to know. */
export type ResolvedReportShare = {
  shareId: string
  organisationId: string
  clientId: string
}

/**
 * Resolves a token to its link, or null for anything that is not a live
 * link. Cross-tenant by design: the holder has no session, so the lookup runs
 * outside withTenant through the SECURITY DEFINER lookup_report_share(), which
 * returns ids only.
 */
export async function resolveReportShare(
  token: unknown
): Promise<ResolvedReportShare | null> {
  if (!isWellFormedReportShareToken(token)) return null
  const [row] = await getDatabase()<ResolvedReportShare[]>`
    select
      share_id::text as "shareId",
      organisation_id::text as "organisationId",
      client_id::text as "clientId"
    from lookup_report_share(${sha256(token)})
  `
  return row ?? null
}

/**
 * Counts a view. Best effort: a failure here is logged and swallowed, never
 * shown to the person reading the report.
 */
export async function recordReportShareView(
  share: ResolvedReportShare
): Promise<void> {
  try {
    await withTenant(share.organisationId, (sql) =>
      sql`
        update report_share
        set last_viewed_at = now(),
            view_count = view_count + 1
        where id = ${share.shareId}
          and revoked_at is null
      `.then(() => undefined)
    )
  } catch (error) {
    log.warn("report_share.view_not_recorded", {
      organisationId: share.organisationId,
      shareId: share.shareId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

type ReportShareRow = {
  id: string
  createdAt: Date
  createdByName: string | null
  expiresAt: Date
  revokedAt: Date | null
  lastViewedAt: Date | null
  viewCount: number
}

export function reportShareStatus(
  row: Pick<ReportShareRow, "expiresAt" | "revokedAt">,
  now: Date = new Date()
): ReportShareStatus {
  if (row.revokedAt) return "revoked"
  return row.expiresAt.getTime() <= now.getTime() ? "expired" : "active"
}

export function toReportShare(
  row: ReportShareRow,
  now: Date = new Date()
): ReportShare {
  return {
    id: row.id,
    status: reportShareStatus(row, now),
    createdAt: row.createdAt.toISOString(),
    createdByName: row.createdByName,
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastViewedAt: row.lastViewedAt?.toISOString() ?? null,
    viewCount: row.viewCount,
  }
}

/** The one select list every report-share read uses. */
export function reportShareColumns(sql: TransactionSql) {
  return sql`
    s.id::text as id,
    s.created_at as "createdAt",
    u.display_name as "createdByName",
    s.expires_at as "expiresAt",
    s.revoked_at as "revokedAt",
    s.last_viewed_at as "lastViewedAt",
    s.view_count as "viewCount"
  `
}

export type { ReportShareRow }
