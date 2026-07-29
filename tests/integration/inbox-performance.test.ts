import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip
const adminUrl = process.env.DIRECT_DATABASE_URL
const runtimeUrl = process.env.TEST_RUNTIME_DATABASE_URL

describeDatabase("100k-review inbox performance", () => {
  let admin: ReturnType<typeof postgres>
  let runtime: ReturnType<typeof postgres>
  const organisationId = crypto.randomUUID()

  beforeAll(async () => {
    if (!adminUrl || !runtimeUrl) {
      throw new Error(
        "DIRECT_DATABASE_URL and TEST_RUNTIME_DATABASE_URL are required."
      )
    }
    admin = postgres(adminUrl, { max: 1, prepare: false })
    runtime = postgres(runtimeUrl, { max: 1, prepare: false })
    const [group] = await admin`
      select 1 as present from pg_roles where rolname = 'naba_app_runtime'
    `
    if (!group) {
      throw new Error(
        "naba_app_runtime missing - run pnpm db:migrate before test:integration"
      )
    }
    const [grant] = await admin`
      select has_table_privilege(
        'naba_app_runtime',
        'review',
        'select'
      ) as ok
    `
    expect(grant.ok).toBe(true)
    await admin`
      insert into organisation (id, slug, name)
      values (
        ${organisationId},
        ${`performance-${organisationId}`},
        'Performance tenant'
      )
    `
    const [connection] = await admin<{ id: string }[]>`
      insert into google_connection (
        organisation_id,
        google_subject,
        google_email,
        scope,
        status
      )
      values (
        ${organisationId},
        ${`subject-${organisationId}`},
        'performance@example.test',
        'business.manage',
        'active'
      )
      returning id::text as id
    `
    await admin`
      insert into location (organisation_id, name)
      select
        ${organisationId},
        'Location ' || generate_series
      from generate_series(1, 500)
    `
    await admin`
      insert into external_location (
        organisation_id,
        google_connection_id,
        google_account_name,
        google_location_name,
        title,
        verified
      )
      select
        ${organisationId},
        ${connection.id},
        'accounts/performance',
        'locations/' || generate_series,
        'Location ' || generate_series,
        true
      from generate_series(1, 500)
    `
    await admin`
      with numbered_locations as (
        select
          l.id as location_id,
          e.id as external_location_id,
          row_number() over (order by l.name)::integer as number
        from location l
        join external_location e
          on e.organisation_id = l.organisation_id
         and e.title = l.name
        where l.organisation_id = ${organisationId}
      )
      insert into review (
        organisation_id,
        location_id,
        external_location_id,
        google_review_name_ciphertext,
        google_review_name_hash,
        google_review_id_ciphertext,
        google_review_id_hash,
        reviewer_display_name,
        star_rating,
        review_text,
        detected_language_code,
        language_confidence,
        create_time,
        update_time,
        content_hash,
        raw_content_expires_at
      )
      select
        ${organisationId},
        nl.location_id,
        nl.external_location_id,
        decode('00', 'hex'),
        'review-name-' || series.number,
        decode('00', 'hex'),
        'review-id-' || series.number,
        'Reviewer ' || series.number,
        ((series.number - 1) % 5) + 1,
        'Performance fixture review ' || series.number,
        'en',
        0.99,
        now() - (series.number * interval '1 second'),
        now() - (series.number * interval '1 second'),
        'content-' || series.number,
        now() + interval '30 days'
      from generate_series(1, 100000) as series(number)
      join numbered_locations nl
        on nl.number = ((series.number - 1) % 500) + 1
    `
  }, 120_000)

  afterAll(async () => {
    if (admin) {
      await admin`delete from organisation where id = ${organisationId}`
    }
    await Promise.all([admin?.end(), runtime?.end()])
  })

  it("keeps the P95 cursor-page query below 1.5 seconds", async () => {
    const durations: number[] = []
    for (let iteration = 0; iteration < 21; iteration += 1) {
      const startedAt = performance.now()
      const rows = await runtime.begin(async (sql) => {
        await sql`
            select set_config(
              'app.organisation_id',
              ${organisationId},
              true
            )
          `
        return sql<{ id: string }[]>`
            select r.id::text as id
            from review r
            join location l on l.id = r.location_id
            left join lateral (
              select id
              from draft
              where review_id = r.id
              order by created_at desc
              limit 1
            ) d on true
            left join review_reply rr on rr.review_id = r.id
            left join lateral (
              select status
              from sync_checkpoint
              where external_location_id = r.external_location_id
              order by updated_at desc
              limit 1
            ) sc on true
            order by r.update_time desc, r.id desc
            limit 50
          `
      })
      expect(rows).toHaveLength(50)
      if (iteration) durations.push(performance.now() - startedAt)
    }
    durations.sort((left, right) => left - right)
    const p95 = durations[Math.ceil(durations.length * 0.95) - 1]
    expect(p95).toBeLessThan(1500)
  }, 60_000)
})
