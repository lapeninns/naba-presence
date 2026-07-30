import {
  boundedNumber,
  createLoadTenant,
  destroyLoadTenants,
  diagnostic,
  openAdmin,
  parsePrometheusHistogramP95,
  parseLoadArgs,
  printSummary,
  sleep,
  timedFetch,
} from "./common.mjs"

async function main() {
  const options = parseLoadArgs(process.argv.slice(2))
  const concurrency = boundedNumber(options.concurrency, 50, 1, 500)
  const reviewCount = boundedNumber(options.reviews, 100_000, 100, 1_000_000)
  const admin = openAdmin(options.databaseUrl)
  const organisationIds = []
  const state = {
    sent: 0,
    ok: 0,
    failed: 0,
    durationsMs: [],
  }
  let maxActiveConnections = 0
  let maxParallelWorkers = 0

  try {
    const tenant = await createLoadTenant(admin, {
      label: "rel501-inbox",
      sessionCount: concurrency,
    })
    organisationIds.push(tenant.organisationId)
    await seedInbox(admin, tenant.organisationId, reviewCount)
    const endAt = Date.now() + options.durationSeconds * 1_000
    const poolSampler = (async () => {
      while (Date.now() < endAt) {
        const [activity] = await admin`
          select
            count(*) filter (
              where backend_type = 'client backend'
                and usename = 'naba_app'
            )::integer as active,
            count(*) filter (
              where backend_type = 'parallel worker'
                and usename = 'naba_app'
            )::integer as parallel_workers
          from pg_stat_activity
          where datname = current_database()
            and state = 'active'
        `
        maxActiveConnections = Math.max(
          maxActiveConnections,
          activity.active
        )
        maxParallelWorkers = Math.max(
          maxParallelWorkers,
          activity.parallel_workers
        )
        await sleep(200)
      }
    })()
    await Promise.all([
      poolSampler,
      ...tenant.cookies.map((cookie, worker) =>
        runWorker({
          baseUrl: options.baseUrl,
          cookie,
          worker,
          endAt,
          state,
        })
      ),
    ])
    const tenantTransactionP95Ms = options.metricsUrl
      ? await prometheusHistogramP95(String(options.metricsUrl))
      : null
    diagnostic("rel501.inbox", {
      concurrency,
      reviewRows: reviewCount,
      maxActiveConnections,
      maxParallelWorkers,
      configuredPoolMax: Number(options.poolMax ?? 3),
      tenantTransactionP95Ms,
      responseP95Ms: percentile(state.durationsMs, 0.95),
      responseUnder1500Ms: percentile(state.durationsMs, 0.95) < 1_500,
      poolHealthy:
        maxActiveConnections <= Number(options.poolMax ?? 3),
    })
  } finally {
    if (!options.keepFixture) {
      await destroyLoadTenants(admin, organisationIds)
    }
    await admin.end()
  }
  printSummary(state)
}

async function seedInbox(admin, organisationId, reviewCount) {
  const [connection] = await admin`
    insert into google_connection (
      organisation_id,
      google_subject,
      google_email,
      scope,
      status
    )
    values (
      ${organisationId},
      ${`rel501-inbox-${organisationId}`},
      'rel501-inbox@example.test',
      'business.manage',
      'active'
    )
    returning id::text as id
  `
  await admin`
    insert into location (organisation_id, name)
    select
      ${organisationId},
      'REL-501 Inbox Location ' || number
    from generate_series(1, 100) as number
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
      'accounts/rel501-inbox',
      'locations/rel501-inbox-' || number,
      'REL-501 Inbox Location ' || number,
      true
    from generate_series(1, 100) as number
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
      'rel501-review-name-' || series.number,
      decode('00', 'hex'),
      'rel501-review-id-' || series.number,
      'REL-501 Reviewer ' || series.number,
      ((series.number - 1) % 5) + 1,
      case
        when series.number % 100 = 0
          then 'Excellent breakfast concurrency fixture ' || series.number
        else 'REL-501 concurrency review ' || series.number
      end,
      'en',
      0.99,
      now() - (series.number * interval '1 second'),
      now() - (series.number * interval '1 second'),
      'rel501-content-' || series.number,
      now() + interval '30 days'
    from generate_series(1, ${reviewCount}) as series(number)
    join numbered_locations nl
      on nl.number = ((series.number - 1) % 100) + 1
  `
  await admin`analyze review`
}

async function runWorker({
  baseUrl,
  cookie,
  worker,
  endAt,
  state,
}) {
  let cursor
  let iteration = 0
  while (Date.now() < endAt) {
    const params = new URLSearchParams({
      page_size: "50",
      sort: "updated_desc",
    })
    if ((iteration + worker) % 2 === 1) {
      params.set("search", "excellent breakfast")
    } else if (cursor) {
      params.set("cursor", cursor)
    }
    const result = await timedFetch(`${baseUrl}/api/reviews?${params}`, {
      headers: { cookie },
      signal: AbortSignal.timeout(5_000),
    })
    state.sent += 1
    state.durationsMs.push(result.durationMs)
    if (!result.response?.ok) {
      state.failed += 1
      cursor = undefined
      await sleep(25)
      continue
    }
    state.ok += 1
    const body = await result.response.json()
    cursor = body.nextCursor ?? undefined
    iteration += 1
  }
}

async function prometheusHistogramP95(metricsUrl) {
  const response = await fetch(metricsUrl)
  if (!response.ok) return null
  return parsePrometheusHistogramP95(await response.text())
}

function percentile(values, quantile) {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return (
    Math.round(
      sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] * 100
    ) / 100
  )
}

main().catch((error) => {
  diagnostic("rel501.inbox.fatal", {
    message: error instanceof Error ? error.message : String(error),
  })
  process.exitCode = 1
})
