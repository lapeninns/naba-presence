import postgres from "postgres"
import type { TransactionSql } from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { PostListFilter } from "@/lib/contracts/location-posts"
import { localPostsListQuery } from "@/lib/server/posts"
import { reviewTimelineQuery } from "@/lib/server/review-reads"

import { destroyTenants } from "./helpers/tenant"

// W4-04 / W4-08 (docs/audits/2026-10-14-full-stack-audit): the review
// timeline and the posts list read audit_log by subject through
// audit_log_subject_idx (0134), and a review delete's cascades reach draft
// and review_reply through review_id and pending_draft_id indexes (0135-0138)
// rather than scanning either table.

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip
const adminUrl = process.env.DIRECT_DATABASE_URL
const runtimeUrl = process.env.TEST_RUNTIME_DATABASE_URL

const REVIEWS = 3_000
const POSTS = 60
const AUDIT_ROWS = 200_000

type Plan = { Plan: Record<string, unknown> }[]

function indexNames(plan: unknown): string[] {
  const names: string[] = []
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return
    const record = node as Record<string, unknown>
    if (typeof record["Index Name"] === "string") {
      names.push(record["Index Name"])
    }
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === "object") walk(value)
    }
  }
  walk(plan)
  return names
}

function seqScans(plan: unknown): string[] {
  const tables: string[] = []
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return
    const record = node as Record<string, unknown>
    if (record["Node Type"] === "Seq Scan") {
      tables.push(String(record["Relation Name"]))
    }
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === "object") walk(value)
    }
  }
  walk(plan)
  return tables
}

// The posts-list query as it was before the lateral rewrite: one grouped
// aggregate over every post edit the tenant has, joined back to the posts.
function legacyPostsListQuery(
  sql: TransactionSql,
  input: Parameters<typeof localPostsListQuery>[1]
) {
  const { cursor } = input
  const after = cursor
    ? cursor.at === null
      ? sql`and listed.sort_at is null and listed.id > ${cursor.id}::uuid`
      : sql`and (
          listed.sort_at < ${cursor.at}::text::timestamptz
          or (listed.sort_at = ${cursor.at}::text::timestamptz and listed.id > ${cursor.id}::uuid)
          or listed.sort_at is null
        )`
    : sql``
  const filter = {
    all: sql`true`,
    draft: sql`status = 'draft'`,
    awaiting: sql`status = 'awaiting_approval'`,
    published: sql`status in ('published', 'publishing')`,
    attention: sql`(status in ('failed', 'ambiguous') or (status = 'published' and google_state = 'REJECTED'))`,
  }[input.filter]
  return sql`
    with local_edits as (
      select subject_id, max(created_at) as edited_at
      from audit_log
      where organisation_id = ${input.organisationId}
        and subject_type = 'local_post'
        and action in ('post.draft.created', 'post.updated')
      group by subject_id
    ),
    listed as (
      select
        gbp_local_post.*,
        local_edits.edited_at,
        case
          when status = 'published' or (status = 'failed' and google_state = 'REJECTED' and (last_error_code = 'google_post_rejected' or local_edits.edited_at is null))
            then coalesce(provider_update_time, provider_create_time)
          else local_edits.edited_at
        end as sort_at
      from gbp_local_post
      left join local_edits on local_edits.subject_id = gbp_local_post.id::text
      where location_id = ${input.locationId}
        and status <> 'deleted'
        and ${filter}
        ${input.postId ? sql`and gbp_local_post.id = ${input.postId}::uuid` : sql``}
    )
    select
      listed.id::text as id,
      topic_type as "topicType",
      language_code as "languageCode",
      summary,
      call_to_action as "callToAction",
      event,
      offer,
      media,
      status,
      content_revision::integer as "contentRevision",
      google_post_name as "googlePostName",
      google_state as "googleState",
      google_search_url as "googleSearchUrl",
      last_error_code as "lastErrorCode",
      created_at as "createdAt",
      updated_at as "updatedAt",
      provider_create_time as "providerCreatedAt",
      provider_update_time as "providerUpdatedAt",
      edited_at as "localEditedAt",
      to_char(sort_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorAt"
    from listed
    where true ${after}
    order by sort_at desc nulls last, listed.id
    limit ${input.limit}
  `
}

describeDatabase("audit_log subject and review cascade indexes", () => {
  let admin: ReturnType<typeof postgres>
  let runtime: ReturnType<typeof postgres>
  const organisationId = crypto.randomUUID()
  const otherOrganisationId = crypto.randomUUID()
  let locationId: string
  let reviewId: string

  const asTenant = <T>(work: (sql: TransactionSql) => Promise<T>) =>
    runtime.begin(async (sql) => {
      await sql`select set_config('app.organisation_id', ${organisationId}, true)`
      return work(sql)
    }) as Promise<T>

  const listBoth = (input: Parameters<typeof localPostsListQuery>[1]) =>
    asTenant(async (sql) => ({
      before: [...(await legacyPostsListQuery(sql, input))],
      after: [...(await localPostsListQuery(sql, input))],
    }))

  beforeAll(async () => {
    if (!adminUrl || !runtimeUrl) {
      throw new Error(
        "DIRECT_DATABASE_URL and TEST_RUNTIME_DATABASE_URL are required."
      )
    }
    admin = postgres(adminUrl, { max: 1, prepare: false, onnotice: () => {} })
    runtime = postgres(runtimeUrl, { max: 1, prepare: false })

    for (const id of [organisationId, otherOrganisationId]) {
      await admin`
        insert into organisation (id, slug, name)
        values (${id}, ${`audit-index-${id}`}, 'Audit index tenant')
      `
    }
    const [connection] = await admin<{ id: string }[]>`
      insert into google_connection (
        organisation_id, google_subject, google_email, scope, status
      )
      values (
        ${organisationId}, ${`subject-${organisationId}`},
        'audit-index@example.test', 'business.manage', 'active'
      )
      returning id::text as id
    `
    const [location] = await admin<{ id: string }[]>`
      insert into location (organisation_id, name)
      values (${organisationId}, 'Audit index location')
      returning id::text as id
    `
    locationId = location.id
    const [external] = await admin<{ id: string }[]>`
      insert into external_location (
        organisation_id, google_connection_id, google_account_name,
        google_location_name, title, verified
      )
      values (
        ${organisationId}, ${connection.id}, 'accounts/audit-index',
        'locations/audit-index', 'Audit index location', true
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
        ${organisationId}, ${locationId}, ${external.id},
        decode('00', 'hex'), 'audit-index-name-' || n,
        decode('00', 'hex'), 'audit-index-id-' || n,
        'Reviewer ' || n, (n % 5) + 1, 'Review ' || n,
        now() - n * interval '1 minute', now() - n * interval '1 minute',
        'content-' || n, now() + interval '30 days'
      from generate_series(1, ${REVIEWS}) as n
    `
    // Two drafts, one reply (every tenth parked on its latest draft for
    // approval) and one approval decision per review.
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
      insert into review_reply (organisation_id, review_id, publish_status)
      select ${organisationId}, r.id, 'not_published'
      from review r
      where r.organisation_id = ${organisationId}
    `
    await admin`
      update review_reply rr
      set publish_status = 'awaiting_approval', pending_draft_id = (
        select d.id from draft d
        where d.review_id = rr.review_id
        order by d.created_at desc limit 1
      )
      where rr.organisation_id = ${organisationId}
        and (hashtext(rr.review_id::text) % 10) = 0
    `
    await admin`
      insert into approval_decision (organisation_id, review_id, draft_id, decision)
      select ${organisationId}, d.review_id, d.id, 'approved'
      from draft d
      where d.organisation_id = ${organisationId}
        and d.created_at = (
          select max(created_at) from draft x where x.review_id = d.review_id
        )
    `
    // Posts in every status, with a mix of edited and never-edited rows and
    // tied provider times, so the sort and keyset paging cover the cases the
    // lateral rewrite must keep.
    await admin`
      insert into gbp_local_post (
        organisation_id, location_id, external_location_id, topic_type,
        summary, status, google_state, last_error_code, provider_create_time,
        provider_update_time, google_post_name
      )
      select
        ${organisationId}, ${locationId}, ${external.id}, 'STANDARD',
        'Post ' || n,
        (array['draft', 'awaiting_approval', 'published', 'failed',
               'ambiguous', 'publishing', 'deleted'])[(n % 7) + 1],
        case when n % 7 = 3 then 'REJECTED' when n % 7 = 2 and n % 3 = 0 then 'REJECTED' else 'LIVE' end,
        case when n % 7 = 3 and n % 2 = 0 then 'google_post_rejected' else null end,
        timestamptz '2026-09-01' + (n / 3) * interval '1 hour',
        case when n % 4 = 0 then null else timestamptz '2026-09-02' + (n / 3) * interval '1 hour' end,
        'accounts/a/locations/b/localPosts/' || n
      from generate_series(1, ${POSTS}) as n
    `
    // The tenant's audit history: mostly other subjects, as in production,
    // with timeline rows for every review and edits for two thirds of the
    // posts (some with tied timestamps). The other tenant's rows share the
    // subjects' ids, which RLS and the organisation predicate must exclude.
    await admin`
      insert into audit_log (
        organisation_id, action, subject_type, subject_id, request_id,
        metadata, created_at
      )
      select
        ${organisationId},
        (array['location.updated', 'hours.updated', 'review.reply.published',
               'member.invited'])[(n % 4) + 1],
        (array['location', 'location', 'review', 'member'])[(n % 4) + 1],
        case when n % 4 = 2
          then (select id::text from review where organisation_id = ${organisationId} and google_review_name_hash = 'audit-index-name-' || (((n / 4) % ${REVIEWS}) + 1))
          else 'subject-' || (n % 5000)
        end,
        'request-' || n,
        case when n % 9 = 0 then '{"note":"x"}'::jsonb else '{}'::jsonb end,
        now() - n * interval '1 second'
      from generate_series(1, ${AUDIT_ROWS}) as n
    `
    await admin`
      insert into audit_log (
        organisation_id, action, subject_type, subject_id, request_id, created_at
      )
      select
        ${organisationId},
        (array['post.draft.created', 'post.updated', 'post.published'])[(e % 3) + 1],
        'local_post', p.id::text, 'post-request-' || p.id || '-' || e,
        timestamptz '2026-09-10' + (row_number() over (order by p.id) / 2) * interval '1 minute' + e * interval '1 hour'
      from gbp_local_post p cross join generate_series(0, 4) as e
      where p.organisation_id = ${organisationId}
        and (hashtext(p.id::text) % 3) <> 0
    `
    await admin`
      insert into audit_log (
        organisation_id, action, subject_type, subject_id, request_id, created_at
      )
      select ${otherOrganisationId}, a.action, a.subject_type, a.subject_id,
        a.request_id, a.created_at + interval '1 day'
      from audit_log a
      where a.organisation_id = ${organisationId}
        and a.subject_type in ('local_post', 'review')
    `
    await admin`vacuum analyze audit_log`
    await admin`analyze review`
    await admin`analyze draft`
    await admin`analyze review_reply`
    await admin`analyze approval_decision`
    await admin`analyze gbp_local_post`

    const [review] = await admin<{ id: string }[]>`
      select rr.review_id::text as id
      from review_reply rr
      where rr.organisation_id = ${organisationId}
        and rr.pending_draft_id is not null
      limit 1
    `
    reviewId = review.id
  }, 300_000)

  afterAll(async () => {
    if (admin) {
      await destroyTenants(admin, [organisationId, otherOrganisationId])
    }
    await Promise.all([admin?.end(), runtime?.end()])
  }, 120_000)

  it("serves the review timeline from audit_log_subject_idx under RLS", async () => {
    const [{ "QUERY PLAN": plan }] = await asTenant(
      (sql) =>
        sql<{ "QUERY PLAN": Plan }[]>`
          explain (format json) ${reviewTimelineQuery(sql, reviewId)}
        `
    )
    expect(indexNames(plan)).toContain("audit_log_subject_idx")
    expect(seqScans(plan)).not.toContain("audit_log")

    const timeline = await asTenant((sql) => reviewTimelineQuery(sql, reviewId))
    const expected = await admin<{ createdAt: Date }[]>`
      select created_at as "createdAt"
      from audit_log
      where organisation_id = ${organisationId}
        and subject_type = 'review' and subject_id = ${reviewId}
      order by created_at desc
      limit 100
    `
    expect(timeline.length).toBeGreaterThan(0)
    expect(timeline.map((row) => row.createdAt)).toEqual(
      expected.map((row) => row.createdAt)
    )
  })

  it("probes each listed post's latest edit through audit_log_subject_idx", async () => {
    const [{ "QUERY PLAN": plan }] = await asTenant(
      (sql) =>
        sql<{ "QUERY PLAN": Plan }[]>`
          explain (format json) ${localPostsListQuery(sql, {
            organisationId,
            locationId,
            filter: "all",
            cursor: null,
            limit: 21,
          })}
        `
    )
    expect(indexNames(plan)).toContain("audit_log_subject_idx")
    expect(seqScans(plan)).not.toContain("audit_log")
  })

  it("lists exactly the rows the grouped query listed, in every view and page", async () => {
    const filters: PostListFilter[] = [
      "all",
      "draft",
      "awaiting",
      "published",
      "attention",
    ]
    let compared = 0
    for (const filter of filters) {
      let cursor: { at: string | null; id: string } | null = null
      for (let page = 0; page < 20; page += 1) {
        const input = { organisationId, locationId, filter, cursor, limit: 7 }
        const { before, after } = await listBoth(input)
        expect(after).toEqual(before)
        compared += after.length
        const last = after.at(-1)
        if (after.length < input.limit || !last) break
        cursor = { at: last.cursorAt, id: last.id }
      }
    }
    // Every non-deleted post is in "all", and the edited ones carry a time.
    expect(compared).toBeGreaterThan(POSTS)

    const [post] = await admin<{ id: string }[]>`
      select id::text as id from gbp_local_post
      where organisation_id = ${organisationId} and status <> 'deleted'
      limit 1
    `
    const single = {
      organisationId,
      locationId,
      filter: "all" as const,
      postId: post.id,
      cursor: null,
      limit: 2,
    }
    const { before, after } = await listBoth(single)
    expect(after).toHaveLength(1)
    expect(after).toEqual(before)
  })

  it("plans each review-delete cascade on draft and review_reply as an index scan", async () => {
    // The statements PostgreSQL's RI triggers run, as the table owner and
    // without RLS, when one review (and so its drafts) is deleted.
    const cascades = [
      {
        sql: admin`explain (format json) delete from only draft where review_id = ${reviewId}::uuid`,
        index: "draft_review_id_idx",
      },
      {
        sql: admin`explain (format json) delete from only review_reply where review_id = ${reviewId}::uuid`,
        index: "review_reply_review_id_idx",
      },
      {
        sql: admin`explain (format json) delete from only approval_decision where review_id = ${reviewId}::uuid`,
        index: "approval_decision_review_id_idx",
      },
      {
        sql: admin`explain (format json) update only review_reply set pending_draft_id = null where pending_draft_id = ${crypto.randomUUID()}::uuid`,
        index: "review_reply_pending_draft_idx",
      },
    ]
    for (const cascade of cascades) {
      const [{ "QUERY PLAN": plan }] = (await cascade.sql) as unknown as {
        "QUERY PLAN": Plan
      }[]
      expect(indexNames(plan), cascade.index).toContain(cascade.index)
      expect(seqScans(plan), cascade.index).toEqual([])
    }
  })

  it("deletes one review without a sequential scan of draft or review_reply", async () => {
    // Rolled back: this measures the real cascade, then leaves the data. The
    // xact view also reports this backend's earlier, not yet flushed scans,
    // and nothing is flushed mid-transaction, so the delete's own scans are
    // the difference across it.
    const seqScans = (sql: TransactionSql) => sql<
      { relname: string; seqScan: number }[]
    >`
      select relname, seq_scan::integer as "seqScan"
      from pg_stat_xact_user_tables
      where relname in ('draft', 'review_reply')
      order by relname
    `
    const deleteScans = (withoutIndexes: boolean) =>
      admin
        .begin(async (sql) => {
          if (withoutIndexes) {
            await sql`
              drop index draft_review_id_idx, review_reply_review_id_idx,
                review_reply_pending_draft_idx
            `
          }
          const before = await seqScans(sql)
          await sql`delete from review where id = ${reviewId}::uuid`
          const after = await seqScans(sql)
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
      { relname: "draft", seqScan: 0 },
      { relname: "review_reply", seqScan: 0 },
    ])
    // The control: the same delete without 0135-0137 scans both tables.
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
