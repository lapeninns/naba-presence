import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  boundedNumber,
  createLoadTenant,
  destroyLoadTenants,
  diagnostic,
  encryptSecret,
  openAdmin,
  parseLoadArgs,
  printSummary,
  seedConnection,
  seedLinkedLocation,
  sha256,
  sleep,
  startLoadStub,
  timedFetch,
} from "./common.mjs"

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const fixturePath = join(root, "tests/fixtures/pubsub/new-review.json")

async function main() {
  const options = parseLoadArgs(process.argv.slice(2))
  const rate = boundedNumber(options.rate, 50, 1, 1_000)
  const maxInFlight = boundedNumber(
    options.maxInFlight,
    Math.max(100, rate * 4),
    1,
    5_000
  )
  const routeCount = boundedNumber(options.routes, 4, 1, 100)
  const stubPort = boundedNumber(options.stubPort, 3211, 1, 65_535)
  const verificationToken = String(
    options.pubsubToken ?? "rel501-pubsub-verification-token"
  )
  const retryWindowSeconds = boundedNumber(
    options.retryWindow,
    120,
    1,
    600
  )
  const ambiguousDelaySeconds = boundedNumber(
    options.ambiguousPutDelay,
    30,
    0,
    600
  )
  const ambiguousSeconds = boundedNumber(
    options.ambiguousPutSeconds,
    0,
    0,
    300
  )
  const admin = openAdmin(options.databaseUrl)
  const organisationIds = []
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"))
  const state = {
    sent: 0,
    ok: 0,
    failed: 0,
    durationsMs: [],
  }
  const inboxDurations = []
  let tenant
  let stub

  try {
    tenant = await createLoadTenant(admin, { label: "rel501-webhook" })
    organisationIds.push(tenant.organisationId)
    await admin`
      update organisation
      set
        approval_required = false,
        direct_publish_consent_at = now(),
        direct_publish_consent_by = ${tenant.userId}
      where id = ${tenant.organisationId}
    `
    const routes = []
    for (let index = 0; index < routeCount; index += 1) {
      const marker =
        `webhook-${tenant.organisationId.slice(0, 8)}-${index}`
      const connection = await seedConnection(admin, {
        organisationId: tenant.organisationId,
        tokenEncryptionKey: options.tokenEncryptionKey,
        marker,
      })
      const location = await seedLinkedLocation(admin, {
        organisationId: tenant.organisationId,
        connectionId: connection.connectionId,
        googleAccountName: connection.googleAccountName,
        marker,
        index: index + 1,
      })
      routes.push({ connection, location })
    }
    const { connection, location } = routes[0]
    const startedAt = Date.now()
    const ambiguousStartsAt =
      startedAt + ambiguousDelaySeconds * 1_000
    const ambiguousEndsAt =
      ambiguousStartsAt + ambiguousSeconds * 1_000
    stub = await startLoadStub({
      port: stubPort,
      handler: ({ method, url, body }) => {
        if (
          method === "PUT" &&
          url.pathname.endsWith("/reply") &&
          Date.now() >= ambiguousStartsAt &&
          Date.now() < ambiguousEndsAt
        ) {
          return {
            status: 500,
            json: { error: { status: "INTERNAL", message: "Injected 500" } },
          }
        }
        if (method === "PUT" && url.pathname.endsWith("/reply")) {
          return {
            status: 200,
            json: {
              comment: body?.comment ?? "",
              updateTime: new Date().toISOString(),
            },
          }
        }
        if (method === "GET" && /\/reviews\/[^/]+$/.test(url.pathname)) {
          return {
            status: 200,
            json: { name: url.pathname.replace(/^\/v4\//, "") },
          }
        }
        if (method === "GET" && url.pathname.endsWith("/reviews")) {
          return {
            status: 200,
            json: { reviews: [], averageRating: 5, totalReviewCount: 0 },
          }
        }
        return { status: 404, json: { error: { status: "NOT_FOUND" } } }
      },
    })

    const endAt = startedAt + options.durationSeconds * 1_000
    const deliveries = new Set()
    let logicalMessages = 0
    const sampler = sampleInbox({
      baseUrl: options.baseUrl,
      cookie: tenant.cookies[0],
      endAt,
      durations: inboxDurations,
    })
    const publishInjection =
      ambiguousSeconds > 0
        ? runAmbiguousPublishInjection({
            admin,
            options,
            tenant,
            connection,
            location,
            startsAt: ambiguousStartsAt,
            endsAt: ambiguousEndsAt,
          }).catch((error) => ({
            requested: 0,
            ambiguousResponses: 0,
            attempts: 0,
            terminalAttempts: 0,
            divergent: 0,
            error: error instanceof Error ? error.message : String(error),
          }))
        : Promise.resolve(null)

    let nextAt = performance.now()
    while (Date.now() < endAt) {
      if (deliveries.size >= maxInFlight) {
        await Promise.race(deliveries)
      }
      logicalMessages += 1
      const messageId = `rel501-${startedAt}-${logicalMessages}`
      const delivery = deliverWithRetry({
        baseUrl: options.baseUrl,
        verificationToken,
        fixture,
        googleLocationName:
          routes[(logicalMessages - 1) % routes.length].location
            .googleLocationName,
        messageId,
        retryUntil: endAt + retryWindowSeconds * 1_000,
        state,
      }).finally(() => deliveries.delete(delivery))
      deliveries.add(delivery)
      nextAt += 1_000 / rate
      const delay = nextAt - performance.now()
      if (delay > 0) await sleep(delay)
    }
    await Promise.all(deliveries)
    await sampler
    const publish = await publishInjection
    if (
      publish &&
      ("error" in publish ||
        publish.terminalAttempts !== publish.attempts ||
        publish.divergent !== 0)
    ) {
      state.failed +=
        ("error" in publish ? 1 : 0) +
        publish.attempts -
        publish.terminalAttempts +
        publish.divergent
    }

    const [events] = await admin`
      select
        count(*)::integer as total,
        count(*) filter (
          where status in ('processed', 'failed', 'dead')
        )::integer as terminal,
        count(*) filter (where status = 'processed')::integer as processed,
        count(*) filter (where status = 'failed')::integer as failed,
        count(*) filter (where status = 'dead')::integer as dead
      from processed_webhook_event
      where organisation_id = ${tenant.organisationId}
    `
    const inboxSummary = percentileSummary(inboxDurations)
    diagnostic("rel501.webhook", {
      logicalMessages,
      eventRows: events.total,
      terminalEventRows: events.terminal,
      processedEventRows: events.processed,
      failedEventRows: events.failed,
      deadEventRows: events.dead,
      lostMessages: logicalMessages - events.total,
      maxInFlight,
      routes: routeCount,
      inbox: inboxSummary,
      publishInjection: publish,
    })
    if (logicalMessages !== events.total) {
      state.failed += logicalMessages - events.total
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

async function deliverWithRetry({
  baseUrl,
  verificationToken,
  fixture,
  googleLocationName,
  messageId,
  retryUntil,
  state,
}) {
  const payload = {
    location: googleLocationName,
    review: `${googleLocationName}/reviews/${messageId}`,
    type: "NEW_REVIEW",
  }
  const envelope = {
    ...fixture,
    message: {
      ...fixture.message,
      data: Buffer.from(JSON.stringify(payload)).toString("base64"),
      messageId,
      publishTime: new Date().toISOString(),
    },
  }
  let attempt = 0
  while (Date.now() < retryUntil) {
    attempt += 1
    const result = await timedFetch(
      `${baseUrl}/api/webhooks/google/pubsub`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-pubsub-token": verificationToken,
        },
        body: JSON.stringify(envelope),
        signal: AbortSignal.timeout(20_000),
      }
    )
    state.sent += 1
    state.durationsMs.push(result.durationMs)
    if (result.response?.ok) {
      state.ok += 1
      return
    }
    state.failed += 1
    await sleep(Math.min(2_000, 250 * 2 ** Math.min(attempt, 3)))
  }
}

async function sampleInbox({ baseUrl, cookie, endAt, durations }) {
  while (Date.now() < endAt) {
    const result = await timedFetch(`${baseUrl}/api/reviews?page_size=50`, {
      headers: { cookie },
      signal: AbortSignal.timeout(5_000),
    })
    if (result.response?.ok) durations.push(result.durationMs)
    await sleep(1_000)
  }
}

async function runAmbiguousPublishInjection({
  admin,
  options,
  tenant,
  connection,
  location,
  startsAt,
  endsAt,
}) {
  const reviewIds = []
  const count = Math.max(1, Math.floor((endsAt - startsAt) / 5_000))
  for (let index = 0; index < count; index += 1) {
    const reviewId = crypto.randomUUID()
    const reviewName =
      `${connection.googleAccountName}/${location.googleLocationName}` +
      `/reviews/rel501-publish-${index}`
    await admin`
      insert into review (
        id,
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
        workflow_status
      )
      values (
        ${reviewId},
        ${tenant.organisationId},
        ${location.locationId},
        ${location.externalLocationId},
        ${encryptSecret(reviewName, options.tokenEncryptionKey)},
        ${sha256(reviewName)},
        ${encryptSecret(`rel501-publish-${index}`, options.tokenEncryptionKey)},
        ${sha256(`rel501-publish-${index}`)},
        'REL-501 reviewer',
        5,
        'Excellent stay and thoughtful service.',
        'en',
        0.99,
        now(),
        now(),
        ${sha256(reviewName)},
        'new'
      )
    `
    reviewIds.push(reviewId)
  }
  await sleep(Math.max(0, startsAt - Date.now()))
  let ambiguousResponses = 0
  for (const reviewId of reviewIds) {
    const draftResult = await timedFetch(
      `${options.baseUrl}/api/reviews/${reviewId}/drafts`,
      {
        method: "POST",
        headers: {
          cookie: tenant.cookies[0],
          "content-type": "application/json",
        },
        body: JSON.stringify({
          tone: "warm_professional",
          body: "Thank you for your excellent review and kind words about the service.",
        }),
        signal: AbortSignal.timeout(20_000),
      }
    )
    const draftResponse = draftResult.response
    if (draftResponse?.status !== 201) continue
    const draft = await draftResponse.json()
    const detailResult = await timedFetch(
      `${options.baseUrl}/api/reviews/${reviewId}`,
      {
        headers: { cookie: tenant.cookies[0] },
        signal: AbortSignal.timeout(20_000),
      }
    )
    const detailResponse = detailResult.response
    if (!detailResponse?.ok) continue
    const detail = await detailResponse.json()
    const publishResult = await timedFetch(
      `${options.baseUrl}/api/reviews/${reviewId}/publish`,
      {
        method: "POST",
        headers: {
          cookie: tenant.cookies[0],
          "content-type": "application/json",
        },
        body: JSON.stringify({
          draftId: draft.draftId,
          expectedReviewUpdateTime: detail.review.updateTime,
        }),
        signal: AbortSignal.timeout(30_000),
      }
    )
    if (publishResult.response?.status === 502) ambiguousResponses += 1
    await sleep(1_000)
  }
  await sleep(Math.max(0, endsAt - Date.now()))
  const recoveryDeadline = Date.now() + 120_000
  while (Date.now() < recoveryDeadline) {
    await admin`
      update publish_attempt
      set next_attempt_at = now()
      where organisation_id = ${tenant.organisationId}
        and status in ('ambiguous', 'retryable')
    `
    const result = await timedFetch(
      `${options.baseUrl}/api/jobs/run`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.cronSecret}`,
          "content-type": "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(30_000),
      },
    )
    const [remaining] = await admin`
      select count(*)::integer as count
      from publish_attempt
      where organisation_id = ${tenant.organisationId}
        and status not in ('succeeded', 'failed')
    `
    if (remaining.count === 0) break
    await sleep(result.response?.ok ? 1_000 : 2_000)
  }
  const [attempts] = await admin`
    select
      count(*)::integer as total,
      count(*) filter (
        where status in ('succeeded', 'failed')
      )::integer as terminal
    from publish_attempt
    where organisation_id = ${tenant.organisationId}
  `
  const [consistency] = await admin`
    select count(*)::integer as divergent
    from publish_attempt pa
    join review_reply rr on rr.id = pa.review_reply_id
    where pa.organisation_id = ${tenant.organisationId}
      and (
        (pa.status = 'succeeded' and rr.publish_status not in ('accepted', 'published'))
        or (pa.status = 'failed' and rr.publish_status = 'published')
      )
  `
  return {
    requested: reviewIds.length,
    ambiguousResponses,
    attempts: attempts.total,
    terminalAttempts: attempts.terminal,
    divergent: consistency.divergent,
  }
}

function percentileSummary(values) {
  const sorted = [...values].sort((left, right) => left - right)
  const at = (quantile) =>
    sorted.length
      ? Math.round(
          sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] * 100
        ) / 100
      : 0
  return {
    samples: sorted.length,
    p95Ms: at(0.95),
    maxMs: sorted.length
      ? Math.round(sorted.at(-1) * 100) / 100
      : 0,
  }
}

main().catch((error) => {
  diagnostic("rel501.webhook.fatal", {
    message: error instanceof Error ? error.message : String(error),
  })
  process.exitCode = 1
})
