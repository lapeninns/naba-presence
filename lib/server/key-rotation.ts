import "server-only"

import type { Fragment, TransactionSql } from "postgres"

import { activeKeyDescriptor, decryptSecret, reencryptSecret } from "@/lib/server/crypto"
import { getDatabase, withTenant } from "@/lib/server/db"
import { refreshTokenFingerprints } from "@/lib/server/google/risc-fingerprint"
import { log } from "@/lib/server/logger"

/**
 * Moves every stored secret onto the active encryption key, resumably.
 *
 * Which rows still need moving is decided in SQL from the stored bytes (the
 * format byte and, for keyed ciphertext, the key id), so each call picks up
 * exactly where the last one stopped, and a verification pass costs a count,
 * not a decrypt. Each row is rewritten with a compare-and-set on its old
 * ciphertext: a token refreshed or a connection disconnected while this runs
 * keeps the newer value.
 *
 * Also backfills the RISC fingerprints (0052) for refresh tokens stored
 * before they existed, since this is the one pass that decrypts them.
 * docs/runbook.md, "Rotating the token encryption key", has the procedure.
 */

type Target = { table: "google_connection" | "invitation" | "review"; columns: string[] }

const TARGETS: Target[] = [
  { table: "google_connection", columns: ["access_token_ciphertext", "refresh_token_ciphertext"] },
  { table: "invitation", columns: ["token_ciphertext"] },
  { table: "review", columns: ["google_review_id_ciphertext", "google_review_name_ciphertext"] },
]

function offActiveKey(sql: TransactionSql, column: string): Fragment {
  const active = activeKeyDescriptor()
  const col = sql(column)
  return active.format === 1
    ? sql`(${col} is not null and get_byte(${col}, 0) <> 1)`
    : sql`(${col} is not null and (get_byte(${col}, 0) <> 2 or substring(${col} from 2 for 4) <> ${active.keyId}))`
}

function anyOffActiveKey(sql: TransactionSql, target: Target): Fragment {
  return target.columns
    .map((column) => offActiveKey(sql, column))
    .reduce((left, right) => sql`${left} or ${right}`)
}

export type RotationReport = {
  dryRun: boolean
  organisations: number
  rewritten: number
  fingerprinted: number
  failed: number
  /** Rows still not on the active key after this call, per table. */
  remaining: Record<Target["table"], number>
  complete: boolean
}

async function rotateTenant(
  organisationId: string,
  options: { dryRun: boolean; batchSize: number; deadline: number },
  report: RotationReport
) {
  for (const target of TARGETS) {
    for (;;) {
      if (Date.now() >= options.deadline) return
      const rows = options.dryRun
        ? []
        : await withTenant(organisationId, (sql) =>
            sql<Record<string, Buffer | string | null>[]>`
              select id::text as id, ${sql(target.columns)}
              from ${sql(target.table)}
              where ${anyOffActiveKey(sql, target)}
              order by id
              limit ${options.batchSize}
            `
          )
      if (rows.length === 0) break
      for (const row of rows) {
        await withTenant(organisationId, async (sql) => {
          for (const column of target.columns) {
            const old = row[column]
            if (!(old instanceof Buffer)) continue
            let next: Buffer
            try {
              next = reencryptSecret(old)
            } catch (error) {
              // Undecryptable with every configured key: leave it (the old
              // key must not be retired) and say so.
              report.failed += 1
              log.error("key_rotation.row_failed", {
                organisationId,
                table: target.table,
                column,
                id: row.id,
                error,
              })
              continue
            }
            const updated = await sql`
              update ${sql(target.table)}
              set ${sql(column)} = ${next}
              where id = ${row.id as string}
                and ${sql(column)} = ${old}
              returning id
            `
            report.rewritten += updated.length
          }
        })
      }
      if (rows.length < options.batchSize) break
    }
  }
  if (!options.dryRun && Date.now() < options.deadline) {
    report.fingerprinted += await backfillFingerprints(organisationId)
  }
}

async function backfillFingerprints(organisationId: string): Promise<number> {
  return withTenant(organisationId, async (sql) => {
    const rows = await sql<{ id: string; refresh: Buffer }[]>`
      select id::text as id, refresh_token_ciphertext as refresh
      from google_connection
      where refresh_token_ciphertext is not null
        and refresh_token_sha512x2 is null
    `
    let done = 0
    for (const row of rows) {
      let fingerprints: ReturnType<typeof refreshTokenFingerprints>
      try {
        fingerprints = refreshTokenFingerprints(decryptSecret(row.refresh))
      } catch {
        continue
      }
      const updated = await sql`
        update google_connection
        set refresh_token_sha512x2 = ${fingerprints.sha512x2},
            refresh_token_prefix_sha256 = ${fingerprints.prefixSha256}
        where id = ${row.id}
          and refresh_token_ciphertext = ${row.refresh}
        returning id
      `
      done += updated.length
    }
    return done
  })
}

async function remaining(organisationIds: string[]): Promise<RotationReport["remaining"]> {
  const totals = { google_connection: 0, invitation: 0, review: 0 }
  for (const organisationId of organisationIds) {
    await withTenant(organisationId, async (sql) => {
      for (const target of TARGETS) {
        const [row] = await sql<{ count: number }[]>`
          select count(*)::int as count
          from ${sql(target.table)}
          where ${anyOffActiveKey(sql, target)}
        `
        totals[target.table] += row?.count ?? 0
      }
    })
  }
  return totals
}

export async function rotateEncryptionKeys(options: {
  dryRun: boolean
  batchSize: number
  budgetMs: number
  /** Limit the pass to these organisations (a staged rotation). */
  organisationIds?: string[]
}): Promise<RotationReport> {
  const deadline = Date.now() + options.budgetMs
  // Cross-tenant enumeration through organisation_job_route, like every
  // fleet tick: a trigger gives every organisation a row, and `organisation`
  // itself is RLS-scoped to one tenant.
  const database = getDatabase()
  const organisations = await database<{ id: string }[]>`
    select organisation_id::text as id from organisation_job_route
    ${
      options.organisationIds?.length
        ? database`where organisation_id in ${database(options.organisationIds)}`
        : database``
    }
    order by organisation_id
  `
  const report: RotationReport = {
    dryRun: options.dryRun,
    organisations: organisations.length,
    rewritten: 0,
    fingerprinted: 0,
    failed: 0,
    remaining: { google_connection: 0, invitation: 0, review: 0 },
    complete: false,
  }
  for (const organisation of organisations) {
    if (Date.now() >= deadline) break
    await rotateTenant(organisation.id, { ...options, deadline }, report)
  }
  report.remaining = await remaining(organisations.map((organisation) => organisation.id))
  report.complete = Object.values(report.remaining).every((count) => count === 0)
  return report
}
