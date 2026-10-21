import postgres from "postgres"
import type { TransactionSql } from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { destroyTenants } from "./helpers/tenant"

// W4-08 follow-up (docs/audits/2026-10-14-full-stack-audit): when retention's
// disconnectedReviews purge deletes a review, its drafts go with it, which
// sets publish_attempt.draft_id and approval_decision.draft_id to null, and
// its reply's publish attempts go too, which deletes their events. 0138-0140
// give each of those foreign keys a leading index, so none of the three RI
// statements scans its table.

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip
const adminUrl = process.env.DIRECT_DATABASE_URL

const REVIEWS = 3_000

const INDEXES = [
  "publish_attempt_draft_id_idx",
  "approval_decision_draft_id_idx",
  "publish_attempt_event_attempt_idx",
] as const

type Plan = { Plan: Record<string, unknown> }[]

function planNodes(plan: unknown, key: string, match?: string): string[] {
  const found: string[] = []
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return
    const record = node as Record<string, unknown>
    if (match === undefined && typeof record[key] === "string") {
      found.push(record[key])
    }
    if (match !== undefined && record["Node Type"] === match) {
      found.push(String(record[key]))
    }
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === "object") walk(value)
    }
  }
  walk(plan)
  return found
}

const indexNames = (plan: unknown) => planNodes(plan, "Index Name")
const seqScans = (plan: unknown) => planNodes(plan, "Relation Name", "Seq Scan")

describeDatabase("publish attempt and approval decision FK indexes", () => {
  let admin: ReturnType<typeof postgres>
  const organisationId = crypto.randomUUID()
  let reviewId: string
  let draftId: string
  let attemptId: string

  beforeAll(async () => {
    if (!adminUrl) throw new Error("DIRECT_DATABASE_URL is required.")
    admin = postgres(adminUrl, { max: 1, prepare: false, onnotice: () => {} })

    await admin`
      insert into organisation (id, slug, name)
      values (${organisationId}, ${`publish-fk-${organisationId}`}, 'Publish FK tenant')
    `
    const [connection] = await admin<{ id: string }[]>`
      insert into google_connection (
        organisation_id, google_subject, google_email, scope, status
      )
      values (
        ${organisationId}, ${`subject-${organisationId}`},
        'publish-fk@example.test', 'business.manage', 'active'
      )
      returning id::text as id
    `
    const [location] = await admin<{ id: string }[]>`
      insert into location (organisation_id, name)
      values (${organisationId}, 'Publish FK location')
      returning id::text as id
    `
    const [external] = await admin<{ id: string }[]>`
      insert into external_location (
        organisation_id, google_connection_id, google_account_name,
        google_location_name, title, verified
      )
      values (
        ${organisationId}, ${connection.id}, 'accounts/publish-fk',
        'locations/publish-fk', 'Publish FK location', true
      )
      returning id::text as id
    `
    await admin`
      insert into review (
        organisation_id, location_id, external_location_id,
        google_review_name_ciphertext, google_review_name_hash,
        google_review_id_ciphertext, google_review_id_hash,
        reviewer_display_name, star_rating, review_text, create_time,
        update_time, content_hash, raw_content_expires_at
      )
      select
        ${organisationId}, ${location.id}, ${external.id},
        decode('00', 'hex'), 'publish-fk-name-' || n,
        decode('00', 'hex'), 'publish-fk-id-' || n,
        'Reviewer ' || n, (n % 5) + 1, 'Review ' || n,
        now() - n * interval '1 minute', now() - n * interval '1 minute',
        'content-' || n, now() + interval '30 days'
      from generate_series(1, ${REVIEWS}) as n
    `
    // Per review: two drafts, each approved, one reply, one publish attempt
    // per draft and three events per attempt.
    await admin`
      insert into draft (
        organisation_id, review_id, source, body, body_bytes, evidence_hash,
        created_at
      )
      select ${organisationId}, r.id, 'human', 'Thanks', 6, 'evidence',
        now() - d * interval '1 second'
      from review r cross join generate_series(1, 2) as d
      where r.organisation_id = ${organisationId}
    `
    await admin`
      insert into approval_decision (organisation_id, review_id, draft_id, decision)
      select ${organisationId}, d.review_id, d.id, 'approved'
      from draft d
      where d.organisation_id = ${organisationId}
    `
    await admin`
      insert into review_reply (organisation_id, review_id, publish_status)
      select ${organisationId}, r.id, 'published'
      from review r
      where r.organisation_id = ${organisationId}
    `
    await admin`
      insert into publish_attempt (
        organisation_id, review_reply_id, draft_id, idempotency_key,
        request_body_hash, status, attempt_no
      )
      select ${organisationId}, rr.id, d.id, 'publish-fk-' || d.id,
        'hash', 'succeeded',
        row_number() over (partition by rr.id order by d.created_at)
      from review_reply rr
      join draft d on d.review_id = rr.review_id
      where rr.organisation_id = ${organisationId}
    `
    await admin`
      insert into publish_attempt_event (
        organisation_id, publish_attempt_id, event_type
      )
      select ${organisationId}, pa.id,
        (array['started', 'provider_accepted', 'completed'])[e]
      from publish_attempt pa cross join generate_series(1, 3) as e
      where pa.organisation_id = ${organisationId}
    `
    for (const table of [
      "review",
      "draft",
      "approval_decision",
      "review_reply",
      "publish_attempt",
      "publish_attempt_event",
    ]) {
      await admin`analyze ${admin(table)}`
    }

    const [row] = await admin<
      { reviewId: string; draftId: string; attemptId: string }[]
    >`
      select d.review_id::text as "reviewId", d.id::text as "draftId",
        pa.id::text as "attemptId"
      from publish_attempt pa
      join draft d on d.id = pa.draft_id
      where pa.organisation_id = ${organisationId}
      limit 1
    `
    ;({ reviewId, draftId, attemptId } = row)
  }, 60_000)

  afterAll(async () => {
    if (admin) await destroyTenants(admin, [organisationId])
    await admin?.end()
  }, 30_000)

  it("plans each RI statement on the three foreign keys as an index scan", async () => {
    // The statements PostgreSQL's RI triggers run, as the table owner and
    // with RLS bypassed, for one deleted draft and one deleted attempt.
    const statements = [
      {
        sql: admin`explain (format json) update only publish_attempt set draft_id = null where draft_id = ${draftId}::uuid`,
        index: "publish_attempt_draft_id_idx",
      },
      {
        sql: admin`explain (format json) update only approval_decision set draft_id = null where draft_id = ${draftId}::uuid`,
        index: "approval_decision_draft_id_idx",
      },
      {
        sql: admin`explain (format json) delete from only publish_attempt_event where publish_attempt_id = ${attemptId}::uuid`,
        index: "publish_attempt_event_attempt_idx",
      },
    ]
    for (const statement of statements) {
      const [{ "QUERY PLAN": plan }] = (await statement.sql) as unknown as {
        "QUERY PLAN": Plan
      }[]
      expect(indexNames(plan), statement.index).toContain(statement.index)
      expect(seqScans(plan), statement.index).toEqual([])
    }
  })

  it("purges one review without a sequential scan of the three tables", async () => {
    // Rolled back, as in audit-subject-index.test.ts: the xact view reports
    // this backend's unflushed scans, so the delete's own scans are the
    // difference across it. app.retention_run lets the cascade delete the
    // append-only publish_attempt_event rows, as the retention purge does.
    const scans = (sql: TransactionSql) => sql<
      { relname: string; seqScan: number }[]
    >`
      select relname, seq_scan::integer as "seqScan"
      from pg_stat_xact_user_tables
      where relname in (
        'approval_decision', 'publish_attempt', 'publish_attempt_event'
      )
      order by relname
    `
    const deleteScans = (withoutIndexes: boolean) =>
      admin
        .begin(async (sql) => {
          if (withoutIndexes) {
            await sql`drop index ${sql(INDEXES as unknown as string[])}`
          }
          await sql`select set_config('app.retention_run', 'true', true)`
          const before = await scans(sql)
          const deleted = await sql`
            delete from review where id = ${reviewId}::uuid returning id
          `
          expect(deleted).toHaveLength(1)
          const after = await scans(sql)
          const [{ events }] = await sql<{ events: number }[]>`
            select count(*)::integer as events
            from publish_attempt_event where publish_attempt_id = ${attemptId}::uuid
          `
          expect(events).toBe(0)
          const rows = after.map((row) => ({
            relname: row.relname,
            seqScan:
              row.seqScan -
              (before.find((other) => other.relname === row.relname)?.seqScan ??
                0),
          }))
          throw Object.assign(new Error("rollback"), { rows })
        })
        .catch((error: Error & { rows?: unknown }) => {
          if (!error.rows) throw error
          return error.rows as { relname: string; seqScan: number }[]
        })
    expect(await deleteScans(false)).toEqual([
      { relname: "approval_decision", seqScan: 0 },
      { relname: "publish_attempt", seqScan: 0 },
      { relname: "publish_attempt_event", seqScan: 0 },
    ])
    // The control: the same purge without 0138-0140 scans all three.
    const control = await deleteScans(true)
    expect(
      control.every((row) => row.seqScan > 0),
      JSON.stringify(control)
    ).toBe(true)
    const [still] =
      await admin`select 1 from review where id = ${reviewId}::uuid`
    expect(still).toBeDefined()
  })
})
