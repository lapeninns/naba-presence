import {
  boundedNumber,
  createLoadTenant,
  destroyLoadTenants,
  diagnostic,
  openAdmin,
  parseLoadArgs,
  printSummary,
  seedConnection,
  seedLinkedLocation,
  startLoadStub,
  timedFetch,
} from "./common.mjs"

async function main() {
  const options = parseLoadArgs(process.argv.slice(2))
  const locationCount = boundedNumber(options.locations, 100, 1, 500)
  const reviewsPerLocation = boundedNumber(
    options.reviewsPerLocation,
    500,
    1,
    5_000
  )
  const schedulerOrganisations = boundedNumber(
    options.schedulerOrganisations,
    100,
    1,
    500
  )
  const stubPort = boundedNumber(options.stubPort, 3211, 1, 65_535)
  const admin = openAdmin(options.databaseUrl)
  const organisationIds = []
  const state = {
    sent: 0,
    ok: 0,
    failed: 0,
    durationsMs: [],
  }
  let stubMode = "backfill"
  let stub

  try {
    const tenant = await createLoadTenant(admin, { label: "rel501-backfill" })
    organisationIds.push(tenant.organisationId)
    const connection = await seedConnection(admin, {
      organisationId: tenant.organisationId,
      tokenEncryptionKey: options.tokenEncryptionKey,
      marker: "backfill-main",
    })
    const locations = []
    for (let index = 0; index < locationCount; index += 1) {
      locations.push(
        await seedLinkedLocation(admin, {
          organisationId: tenant.organisationId,
          connectionId: connection.connectionId,
          googleAccountName: connection.googleAccountName,
          marker: `backfill-${index}`,
          index: index + 1,
        })
      )
    }
    const locationIndex = new Map(
      locations.map((location, index) => [
        location.googleLocationName.replace(/^locations\//, ""),
        index,
      ])
    )
    stub = await startLoadStub({
      port: stubPort,
      handler: ({ method, url }) => {
        if (method !== "GET" || !url.pathname.endsWith("/reviews")) {
          return { status: 404, json: { error: { status: "NOT_FOUND" } } }
        }
        if (stubMode !== "backfill") {
          return {
            status: 200,
            json: { reviews: [], averageRating: 5, totalReviewCount: 0 },
          }
        }
        const match = url.pathname.match(/\/locations\/([^/]+)\/reviews$/)
        const locationNumber = locationIndex.get(match?.[1])
        if (locationNumber === undefined) {
          return { status: 200, json: { reviews: [] } }
        }
        const page = Number(url.searchParams.get("pageToken") ?? "0")
        const start = page * 50
        const remaining = reviewsPerLocation - start
        const size = Math.max(0, Math.min(50, remaining))
        const reviews = Array.from({ length: size }, (_, offset) => {
          const number = start + offset
          const reviewName =
            `${connection.googleAccountName}/` +
            `${locations[locationNumber].googleLocationName}/` +
            `reviews/rel501-${locationNumber}-${number}`
          const updateTime = new Date(
            Date.UTC(2026, 6, 1) - number * 1_000
          ).toISOString()
          return {
            name: reviewName,
            reviewId: `rel501-${locationNumber}-${number}`,
            reviewer: {
              displayName: `Reviewer ${locationNumber}-${number}`,
              isAnonymous: false,
            },
            starRating: ["ONE", "TWO", "THREE", "FOUR", "FIVE"][
              number % 5
            ],
            comment: `REL-501 backfill review ${locationNumber}-${number}`,
            createTime: updateTime,
            updateTime,
          }
        })
        const hasMore = start + size < reviewsPerLocation
        return {
          status: 200,
          json: {
            reviews,
            nextPageToken: hasMore ? String(page + 1) : undefined,
            averageRating: 3,
            totalReviewCount: reviewsPerLocation,
          },
        }
      },
    })

    const backfillStartedAt = performance.now()
    const deadline = Date.now() + options.durationSeconds * 1_000
    await recordRequest(state, () =>
      fetch(`${options.baseUrl}/api/sync/backfill`, {
        method: "POST",
        headers: {
          cookie: tenant.cookies[0],
          "content-type": "application/json",
        },
        body: JSON.stringify({ maxPagesPerLocation: 5 }),
        signal: AbortSignal.timeout(
          Math.max(60_000, options.durationSeconds * 1_000)
        ),
      })
    )
    for (let iteration = 0; iteration < 100; iteration += 1) {
      const [remaining] = await admin`
        select count(*)::integer as count
        from sync_checkpoint
        where organisation_id = ${tenant.organisationId}
          and sync_type = 'backfill'
          and status <> 'succeeded'
      `
      if (remaining.count === 0) break
      if (Date.now() >= deadline) {
        state.failed += remaining.count
        break
      }
      await admin`
        update sync_checkpoint
        set next_attempt_at = now()
        where organisation_id = ${tenant.organisationId}
          and sync_type = 'backfill'
          and status in ('pending', 'failed')
      `
      await recordRequest(state, () =>
        fetch(`${options.baseUrl}/api/jobs/run`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.cronSecret}`,
            "content-type": "application/json",
          },
          body: "{}",
          signal: AbortSignal.timeout(60_000),
        })
      )
    }

    const [backfill] = await admin`
      select
        (select count(*)::integer from review
          where organisation_id = ${tenant.organisationId}) as reviews,
        (select count(*)::integer from (
          select google_review_name_hash
          from review
          where organisation_id = ${tenant.organisationId}
          group by google_review_name_hash
          having count(*) > 1
        ) duplicates) as duplicates,
        (select count(*)::integer from sync_checkpoint
          where organisation_id = ${tenant.organisationId}
            and sync_type = 'backfill'
            and status <> 'succeeded') as incomplete
    `
    const backfillDurationMs = performance.now() - backfillStartedAt

    for (
      let index = 1;
      index < schedulerOrganisations;
      index += 1
    ) {
      const scaleTenant = await createLoadTenant(admin, {
        label: `rel501-scheduler-${index}`,
      })
      organisationIds.push(scaleTenant.organisationId)
      const scaleConnection = await seedConnection(admin, {
        organisationId: scaleTenant.organisationId,
        tokenEncryptionKey: options.tokenEncryptionKey,
        marker: `scheduler-${index}`,
      })
      await seedLinkedLocation(admin, {
        organisationId: scaleTenant.organisationId,
        connectionId: scaleConnection.connectionId,
        googleAccountName: scaleConnection.googleAccountName,
        marker: `scheduler-${index}`,
        index,
      })
    }
    stubMode = "reconcile"
    const reconcileDeadline = Date.now() + 120_000
    let reconcileDurationMs = 0
    let organisationCursor
    let processed = 0
    let pages = 0
    do {
      const result = await timedFetch(
        `${options.baseUrl}/api/sync/reconcile`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.cronSecret}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            organisationCursor,
            maxOrganisations: 100,
          }),
          signal: AbortSignal.timeout(60_000),
        }
      )
      state.sent += 1
      state.durationsMs.push(result.durationMs)
      if (!result.response?.ok) {
        state.failed += 1
        break
      }
      state.ok += 1
      const body = await result.response.json()
      if (body.skipped) {
        if (Date.now() >= reconcileDeadline) {
          state.failed += 1
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000))
        continue
      }
      reconcileDurationMs += result.durationMs
      processed += body.processed ?? 0
      organisationCursor = body.nextCursor ?? undefined
      pages += 1
    } while (
      (pages === 0 || organisationCursor !== undefined) &&
      pages < 1_000
    )
    reconcileDurationMs = Math.round(reconcileDurationMs * 100) / 100
    diagnostic("rel501.backfill", {
      locations: locationCount,
      reviewsPerLocation,
      expectedReviews: locationCount * reviewsPerLocation,
      reviewRows: backfill.reviews,
      backfillDurationMs:
        Math.round(backfillDurationMs * 100) / 100,
      duplicateHashes: backfill.duplicates,
      incompleteCheckpoints: backfill.incomplete,
      schedulerOrganisations,
      schedulerProcessed: processed,
      schedulerPages: pages,
      schedulerDurationMs: reconcileDurationMs,
      withinSchedulerBudget: reconcileDurationMs < 45_000,
    })
    if (
      backfill.reviews !== locationCount * reviewsPerLocation ||
      backfill.duplicates !== 0 ||
      backfill.incomplete !== 0
    ) {
      state.failed += 1
    }
    if (
      processed < schedulerOrganisations ||
      reconcileDurationMs >= 45_000
    ) {
      state.failed += 1
    }
  } finally {
    await stub?.stop()
    if (!options.keepFixture) {
      await destroyLoadTenants(admin, organisationIds)
    }
    await admin.end()
  }
  printSummary(state)
}

async function recordRequest(state, request) {
  const startedAt = performance.now()
  try {
    const response = await request()
    state.sent += 1
    state.durationsMs.push(performance.now() - startedAt)
    if (response.ok) state.ok += 1
    else state.failed += 1
    return response
  } catch (error) {
    state.sent += 1
    state.failed += 1
    state.durationsMs.push(performance.now() - startedAt)
    diagnostic("rel501.backfill.request_failed", {
      message: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

main().catch((error) => {
  diagnostic("rel501.backfill.fatal", {
    message: error instanceof Error ? error.message : String(error),
  })
  process.exitCode = 1
})
