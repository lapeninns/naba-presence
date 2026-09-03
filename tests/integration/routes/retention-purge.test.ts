import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
  seedLinkedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

type RetentionOrganisation = Record<string, string | number>

type RetentionResponse = {
  organisations: RetentionOrganisation[]
  failures: { organisationId: string; errorCode: string }[]
  nextCursor: string | null
}

describeDatabase("retention purge", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, {
      max: 1,
      prepare: false,
    })
    server = await startAppServer()
  })

  afterAll(async () => {
    await server?.stop()
    await destroyTenants(admin, organisations)
    await admin?.end()
  })

  async function createTenant() {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    return owner
  }

  /** Walks every page so the fixture organisation is always reached. */
  async function runRetention(): Promise<RetentionResponse> {
    const seen: RetentionOrganisation[] = []
    const failures: RetentionResponse["failures"] = []
    let cursor: string | null = null
    do {
      const query = new URLSearchParams({ batch_size: "100" })
      if (cursor) query.set("cursor", cursor)
      const response = await fetch(
        `${server.baseUrl}/api/cron/retention?${query}`,
        {
          method: "POST",
          headers: { authorization: "Bearer route-harness-cron-secret" },
        }
      )
      expect(response.status).toBe(200)
      const payload = (await response.json()) as RetentionResponse
      seen.push(...payload.organisations)
      failures.push(...payload.failures)
      cursor = payload.nextCursor
    } while (cursor)
    return { organisations: seen, failures, nextCursor: null }
  }

  function entryFor(result: RetentionResponse, organisationId: string) {
    const entry = result.organisations.find(
      (organisation) => organisation.organisationId === organisationId
    )
    if (!entry) {
      throw new Error(`retention did not report ${organisationId}`)
    }
    return entry
  }

  async function seedExpiredMediaItem(input: {
    organisationId: string
    locationId: string
    externalLocationId: string
  }) {
    const [item] = await admin<{ id: string }[]>`
      insert into gbp_media_item (
        organisation_id,
        location_id,
        external_location_id,
        google_media_name,
        ownership,
        media_format,
        source_url,
        google_url,
        thumbnail_url,
        description,
        attribution,
        dimensions,
        insights,
        google_hash,
        payload_expires_at
      )
      values (
        ${input.organisationId},
        ${input.locationId},
        ${input.externalLocationId},
        ${`media/${randomUUID()}`},
        'merchant',
        'PHOTO',
        'https://example.test/source.jpg',
        'https://example.test/google.jpg',
        'https://example.test/thumb.jpg',
        'Expired media description',
        '{"profile":"Reviewer"}'::jsonb,
        '{"width":800}'::jsonb,
        '{"views":12}'::jsonb,
        'media-hash',
        now() - interval '1 day'
      )
      returning id
    `
    return item.id
  }

  it("redacts an expired media payload without violating payload_expires_at", async () => {
    const owner = await createTenant()
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const linked = await seedLinkedLocation(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const mediaItemId = await seedExpiredMediaItem({
      organisationId: owner.organisationId,
      locationId: linked.locationId,
      externalLocationId: linked.externalLocationId,
    })

    const result = await runRetention()
    expect(
      result.failures.map((failure) => failure.organisationId)
    ).not.toContain(owner.organisationId)
    expect(entryFor(result, owner.organisationId).googleMediaPayloads).toBe(1)

    const [item] = await admin<
      {
        sourceUrl: string | null
        googleUrl: string | null
        thumbnailUrl: string | null
        description: string | null
        attribution: unknown
        dimensions: unknown
        insights: unknown
        payloadExpiresAt: Date | null
      }[]
    >`
      select
        source_url as "sourceUrl",
        google_url as "googleUrl",
        thumbnail_url as "thumbnailUrl",
        description,
        attribution,
        dimensions,
        insights,
        payload_expires_at as "payloadExpiresAt"
      from gbp_media_item
      where id = ${mediaItemId}
    `
    expect(item).toMatchObject({
      sourceUrl: null,
      googleUrl: null,
      thumbnailUrl: null,
      description: null,
      attribution: null,
      dimensions: null,
      insights: null,
    })
    // The NOT NULL expiry column (0022) must survive the redaction.
    expect(item.payloadExpiresAt).not.toBeNull()
  }, 30_000)

  it("reports zero for every count on a second consecutive run", async () => {
    const owner = await createTenant()
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const linked = await seedLinkedLocation(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    await seedExpiredMediaItem({
      organisationId: owner.organisationId,
      locationId: linked.locationId,
      externalLocationId: linked.externalLocationId,
    })
    await admin`
      insert into gbp_management_mutation (
        organisation_id,
        location_id,
        actor_user_id,
        resource_type,
        operation,
        status,
        idempotency_key,
        expires_at
      )
      values (
        ${owner.organisationId},
        ${linked.locationId},
        ${owner.userId},
        'business_info',
        'update',
        'succeeded',
        ${randomUUID()},
        now() - interval '1 day'
      )
    `
    await admin`
      insert into gbp_resource_snapshot (
        organisation_id,
        location_id,
        resource_type,
        resource_name,
        payload,
        google_hash,
        expires_at
      )
      values (
        ${owner.organisationId},
        ${linked.locationId},
        'business_info',
        ${`locations/${randomUUID()}`},
        '{"phoneNumbers":{"primaryPhone":"+44 20 7946 0000"}}'::jsonb,
        'snapshot-hash',
        now() - interval '1 day'
      )
    `
    await admin`
      insert into app_session (
        token_hash,
        user_id,
        organisation_id,
        expires_at
      )
      values (
        ${`expired-${randomUUID()}`},
        ${owner.userId},
        ${owner.organisationId},
        now() - interval '30 days'
      )
    `

    const first = entryFor(await runRetention(), owner.organisationId)
    expect(first).toMatchObject({
      googleMediaPayloads: 1,
      managementMutations: 1,
      resourceSnapshots: 1,
      appSessions: 1,
    })

    const second = entryFor(await runRetention(), owner.organisationId)
    const repeated = Object.entries(second).filter(
      ([key, value]) => key !== "organisationId" && value !== 0
    )
    expect(repeated).toEqual([])
  }, 40_000)

  it("purges a disconnected connection but skips locations under a legal hold", async () => {
    const owner = await createTenant()
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const held = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const purgeable = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
      replyState: "APPROVED",
    })
    await admin`
      insert into legal_hold (
        organisation_id,
        review_id,
        reason,
        approved_by
      )
      values (
        ${owner.organisationId},
        ${held.reviewId},
        'Litigation hold ahead of disclosure.',
        ${owner.userId}
      )
    `
    await admin`
      insert into review_media_item (
        organisation_id,
        review_id,
        thumbnail_url,
        thumbnail_label
      )
      values (
        ${owner.organisationId},
        ${purgeable.reviewId},
        'https://example.test/purgeable.jpg',
        'Purgeable media'
      )
    `
    // The cascade has to pass the publish_attempt_event append-only trigger,
    // which only yields while app.retention_run is set.
    const [reply] = await admin<{ id: string }[]>`
      select id from review_reply where review_id = ${purgeable.reviewId}
    `
    const [attempt] = await admin<{ id: string }[]>`
      insert into publish_attempt (
        organisation_id,
        review_reply_id,
        idempotency_key,
        request_body_hash,
        status,
        attempt_no
      )
      values (
        ${owner.organisationId},
        ${reply.id},
        ${randomUUID()},
        'request-hash',
        'succeeded',
        1
      )
      returning id
    `
    await admin`
      insert into publish_attempt_event (
        organisation_id,
        publish_attempt_id,
        event_type
      )
      values (${owner.organisationId}, ${attempt.id}, 'completed')
    `
    await admin`
      update google_connection
      set
        status = 'disconnected',
        disconnected_at = now() - interval '8 days',
        purge_due_at = now() - interval '1 day'
      where id = ${connection.connectionId}
    `

    const result = await runRetention()
    expect(
      result.failures.map((failure) => failure.organisationId)
    ).not.toContain(owner.organisationId)
    expect(entryFor(result, owner.organisationId)).toMatchObject({
      disconnectedLocations: 1,
      heldLocationsSkipped: 1,
    })

    const [survivors] = await admin<
      { locations: number; reviews: number; holds: number }[]
    >`
      select
        (
          select count(*)::int from external_location
          where id = ${held.externalLocationId}
        ) as locations,
        (select count(*)::int from review where id = ${held.reviewId}) as reviews,
        (
          select count(*)::int from legal_hold
          where review_id = ${held.reviewId}
        ) as holds
    `
    expect(survivors).toEqual({ locations: 1, reviews: 1, holds: 1 })

    const [purged] = await admin<
      { locations: number; reviews: number; media: number; events: number }[]
    >`
      select
        (
          select count(*)::int from external_location
          where id = ${purgeable.externalLocationId}
        ) as locations,
        (
          select count(*)::int from review where id = ${purgeable.reviewId}
        ) as reviews,
        (
          select count(*)::int from review_media_item
          where review_id = ${purgeable.reviewId}
        ) as media,
        (
          select count(*)::int from publish_attempt_event
          where publish_attempt_id = ${attempt.id}
        ) as events
    `
    expect(purged).toEqual({ locations: 0, reviews: 0, media: 0, events: 0 })
  }, 40_000)

  it("keeps purging later organisations when one organisation fails", async () => {
    const first = await createTenant()
    const second = await createTenant()
    // The sweep walks organisations in id order, so the poisoned tenant has to
    // be the one that sorts first for this to prove the tail is still reached.
    const [poisoned, healthy] =
      first.organisationId < second.organisationId
        ? [first, second]
        : [second, first]
    const mediaItems = new Map<string, string>()
    for (const owner of [poisoned, healthy]) {
      const connection = await seedGoogleConnection(admin, {
        organisationId: owner.organisationId,
      })
      const linked = await seedLinkedLocation(admin, {
        organisationId: owner.organisationId,
        connectionId: connection.connectionId,
        googleAccountName: connection.googleAccountName,
      })
      mediaItems.set(
        owner.organisationId,
        await seedExpiredMediaItem({
          organisationId: owner.organisationId,
          locationId: linked.locationId,
          externalLocationId: linked.externalLocationId,
        })
      )
    }
    await admin.unsafe(`
      create or replace function retention_isolation_poison()
      returns trigger language plpgsql as $$
      begin
        raise exception 'retention isolation poison';
      end
      $$
    `)
    await admin.unsafe(
      "drop trigger if exists retention_isolation_poison_trigger on gbp_media_item"
    )
    await admin.unsafe(`
      create trigger retention_isolation_poison_trigger
      before update on gbp_media_item
      for each row
      when (old.organisation_id = '${poisoned.organisationId}'::uuid)
      execute function retention_isolation_poison()
    `)

    const result = await runRetention().finally(async () => {
      await admin.unsafe(
        "drop trigger if exists retention_isolation_poison_trigger on gbp_media_item"
      )
      await admin.unsafe("drop function if exists retention_isolation_poison()")
    })

    expect(result.failures).toContainEqual({
      organisationId: poisoned.organisationId,
      errorCode: "internal_error",
    })
    expect(entryFor(result, healthy.organisationId).googleMediaPayloads).toBe(1)

    // The poisoned tenant's transaction rolled back whole.
    const [stalled] = await admin<{ sourceUrl: string | null }[]>`
      select source_url as "sourceUrl"
      from gbp_media_item
      where id = ${mediaItems.get(poisoned.organisationId)!}
    `
    expect(stalled.sourceUrl).toBe("https://example.test/source.jpg")
  }, 40_000)
})
