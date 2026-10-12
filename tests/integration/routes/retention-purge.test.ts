import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
  seedLinkedReview,
} from "../helpers/tenant"

import { withTenant } from "@/lib/server/db"
import { runRetentionCycle } from "@/lib/server/retention/cycle"
import {
  purgeOrganisation,
  retainPage,
  type OrganisationPurgeCounts,
} from "@/lib/server/retention/purge"
import { upsertGoogleReview } from "@/lib/server/reviews"

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
      // A hand-run page (an explicit cursor, empty for the head), so the
      // walk covers the whole fleet now instead of waiting for the cycle.
      query.set("cursor", cursor ?? "")
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

  it("redacts an expired media payload through a dispatcher cycle, not only a hand page", async () => {
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

    // The cycle with its default, real per-organisation purge, on a fixed
    // clock past 03:00 so it opens whatever the time of day.
    await admin`delete from retention_cycle`
    try {
      const fire = () =>
        runRetentionCycle({
          requestId: "retention-purge-cycle",
          clientRequestId: null,
          now: new Date("2026-02-01T03:00:00Z"),
        })
      let result = await fire()
      for (let index = 0; index < 5 && !result.completed; index += 1) {
        result = await fire()
      }
      expect(result.completed).toBe(true)
      const [row] = await admin<{ status: string }[]>`
        select o.status
        from retention_cycle_org o
        join retention_cycle c on c.id = o.cycle_id
        where c.cycle_date = '2026-02-01'
          and o.organisation_id = ${owner.organisationId}
      `
      expect(row).toEqual({ status: "succeeded" })
    } finally {
      await admin`delete from retention_cycle`
    }

    const [item] = await admin<
      { sourceUrl: string | null; description: string | null }[]
    >`
      select source_url as "sourceUrl", description
      from gbp_media_item
      where id = ${mediaItemId}
    `
    expect(item).toEqual({ sourceUrl: null, description: null })
  }, 60_000)

  it("keeps an expired media create that still waits on a person", async () => {
    const owner = await createTenant()
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const linked = await seedLinkedLocation(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const seed = (status: string, resolution: string | null) =>
      admin<{ id: string }[]>`
        insert into gbp_media_mutation (
          organisation_id, location_id, actor_user_id, operation, status,
          idempotency_key, upload_phase, content_sha256, resolution, expires_at
        ) values (
          ${owner.organisationId}, ${linked.locationId}, ${owner.userId},
          'create', ${status}, ${`key-${randomUUID()}`}, 'create_sent',
          ${"d".repeat(64)}, ${resolution}, now() - interval '1 day'
        )
        returning id::text as id
      `.then(([row]) => row.id)
    const pending = await seed("needs_resolution", null)
    const uncertain = await seed("ambiguous", null)
    const resolved = await seed("failed", "abandoned")

    const result = await runRetention()
    expect(
      result.failures.map((failure) => failure.organisationId)
    ).not.toContain(owner.organisationId)
    const left = await admin<{ id: string }[]>`
      select id::text as id from gbp_media_mutation
      where organisation_id = ${owner.organisationId}
    `
    expect(left.map((row) => row.id).sort()).toEqual(
      [pending, uncertain].sort()
    )
    expect(left.map((row) => row.id)).not.toContain(resolved)
  }, 30_000)

  describe("in bounded batches", () => {
    const batchRows = process.env.RETENTION_BATCH_ROWS
    const budget = process.env.RETENTION_BUDGET_MS

    afterEach(() => {
      if (batchRows === undefined) delete process.env.RETENTION_BATCH_ROWS
      else process.env.RETENTION_BATCH_ROWS = batchRows
      if (budget === undefined) delete process.env.RETENTION_BUDGET_MS
      else process.env.RETENTION_BUDGET_MS = budget
    })

    async function backloggedTenant(items: number) {
      const owner = await createTenant()
      const connection = await seedGoogleConnection(admin, {
        organisationId: owner.organisationId,
      })
      const linked = await seedLinkedLocation(admin, {
        organisationId: owner.organisationId,
        connectionId: connection.connectionId,
        googleAccountName: connection.googleAccountName,
      })
      const seed = async (count: number) => {
        for (let index = 0; index < count; index += 1) {
          await seedExpiredMediaItem({
            organisationId: owner.organisationId,
            locationId: linked.locationId,
            externalLocationId: linked.externalLocationId,
          })
        }
      }
      await seed(items)
      return { organisationId: owner.organisationId, seed }
    }

    async function unredacted(organisationId: string) {
      const [row] = await admin<{ count: number }[]>`
        select count(*)::int as count
        from gbp_media_item
        where organisation_id = ${organisationId}
          and source_url is not null
      `
      return row.count
    }

    async function completionAudits(organisationId: string) {
      return admin<{ requestId: string; metadata: Record<string, unknown> }[]>`
        select request_id as "requestId", metadata
        from audit_log
        where organisation_id = ${organisationId}
          and action = 'retention.purge.completed'
        order by created_at
      `
    }

    /** What the per-round audits recorded for one dataset, summed. */
    async function roundAudited(organisationId: string, key: string) {
      const [row] = await admin<{ total: number; rounds: number }[]>`
        select
          coalesce(sum((metadata ->> ${key})::int), 0)::int as total,
          count(*)::int as rounds
        from audit_log
        where organisation_id = ${organisationId}
          and action = 'retention.purge.round'
      `
      return row
    }

    it("changes at most the batch per statement and resumes across runs", async () => {
      process.env.RETENTION_BATCH_ROWS = "2"
      const tenant = await backloggedTenant(7)
      const committed: OrganisationPurgeCounts = {}
      const runs = []
      for (let index = 0; index < 10; index += 1) {
        const prior = { ...committed }
        // A deadline already past: every run stops after its first round.
        const result = await purgeOrganisation({
          organisationId: tenant.organisationId,
          requestId: `retention-batches-${index}`,
          clientRequestId: null,
          deletesEnabled: true,
          deadline: 0,
          priorCounts: prior,
          onProgress: async (counts) => {
            for (const [key, value] of Object.entries(counts)) {
              committed[key] = (committed[key] ?? 0) + value
            }
          },
        })
        runs.push(result)
        if (result.complete) break
        // What a stopped run committed stays committed.
        expect(await unredacted(tenant.organisationId)).toBe(7 - 2 * runs.length)
      }
      expect(
        runs.map((run) => [run.complete, run.rounds, run.counts.googleMediaPayloads])
      ).toEqual([
        [false, 1, 2],
        [false, 1, 2],
        [false, 1, 2],
        [true, 1, 1],
      ])
      expect(await unredacted(tenant.organisationId)).toBe(0)
      expect(committed.googleMediaPayloads).toBe(7)

      // One audit, from the run that caught up, with the totals across runs.
      const audits = await completionAudits(tenant.organisationId)
      expect(audits).toHaveLength(1)
      expect(audits[0].requestId).toBe(
        `retention-batches-3:${tenant.organisationId}`
      )
      expect(audits[0].metadata).toMatchObject({
        googleMediaPayloads: 7,
        batchRows: 2,
        deletesEnabled: true,
      })

      // Every committed round is on record in its own audit row.
      expect(
        await roundAudited(tenant.organisationId, "googleMediaPayloads")
      ).toEqual({ total: 7, rounds: 4 })

      // With time to spare, one run loops its rounds until it catches up.
      await tenant.seed(5)
      const looped = await purgeOrganisation({
        organisationId: tenant.organisationId,
        requestId: "retention-batches-looped",
        clientRequestId: null,
        deletesEnabled: true,
        deadline: Date.now() + 60_000,
      })
      expect(looped).toMatchObject({ complete: true, rounds: 3 })
      expect(looped.counts.googleMediaPayloads).toBe(5)

      // Caught up: a further run reports zero everywhere, in one round, and
      // writes no audit.
      const again = await purgeOrganisation({
        organisationId: tenant.organisationId,
        requestId: "retention-batches-again",
        clientRequestId: null,
        deletesEnabled: true,
        deadline: 0,
      })
      expect(again.complete).toBe(true)
      expect(again.rounds).toBe(1)
      expect(
        Object.entries(again.counts).filter(([, value]) => value !== 0)
      ).toEqual([])
      expect(await completionAudits(tenant.organisationId)).toHaveLength(2)
    }, 60_000)

    it("leaves a backlogged organisation pending across dispatcher fires until it catches up", async () => {
      process.env.RETENTION_BATCH_ROWS = "2"
      process.env.RETENTION_BUDGET_MS = "0"
      const tenant = await backloggedTenant(7)
      await admin`delete from retention_cycle`
      try {
        // A running cycle that has enumerated only this organisation, so the
        // dispatcher works on it alone.
        const [cycle] = await admin<{ id: string }[]>`
          insert into retention_cycle (
            cycle_date, enumerated, enumeration_completed_at
          )
          values ('2026-03-01', 1, now())
          returning id::text as id
        `
        await admin`
          insert into retention_cycle_org (cycle_id, organisation_id)
          values (${cycle.id}, ${tenant.organisationId})
        `
        const fire = (index: number) =>
          runRetentionCycle({
            requestId: `retention-batches-fire-${index}`,
            clientRequestId: null,
            now: new Date("2026-03-01T03:00:00Z"),
          })
        const fires = []
        for (let index = 0; index < 10; index += 1) {
          const result = await fire(index)
          fires.push(result)
          if (result.completed) break
          expect(result.partial).toHaveLength(1)
          expect(result.organisations).toEqual([])
        }
        expect(fires.map((result) => result.completed)).toEqual([
          false,
          false,
          false,
          true,
        ])
        const [row] = await admin<
          {
            status: string
            attempts: number
            resumes: number
            counts: Record<string, number>
          }[]
        >`
          select status, attempts, resumes, counts
          from retention_cycle_org
          where cycle_id = ${cycle.id}
        `
        expect(row).toMatchObject({
          status: "succeeded",
          attempts: 1,
          resumes: 3,
        })
        expect(row.counts.googleMediaPayloads).toBe(7)
        expect(await unredacted(tenant.organisationId)).toBe(0)
        const audits = await completionAudits(tenant.organisationId)
        expect(audits).toHaveLength(1)
        expect(audits[0].metadata).toMatchObject({ googleMediaPayloads: 7 })
      } finally {
        await admin`delete from retention_cycle`
      }
    }, 60_000)

    it("audits every committed round of a run the cycle later gives up on", async () => {
      process.env.RETENTION_BATCH_ROWS = "2"
      process.env.RETENTION_BUDGET_MS = "0"
      const tenant = await backloggedTenant(9)
      await admin`delete from retention_cycle`
      try {
        const [cycle] = await admin<{ id: string }[]>`
          insert into retention_cycle (
            cycle_date, enumerated, enumeration_completed_at
          )
          values ('2026-03-02', 1, now())
          returning id::text as id
        `
        await admin`
          insert into retention_cycle_org (cycle_id, organisation_id)
          values (${cycle.id}, ${tenant.organisationId})
        `
        // The first fire stops on the budget; every later one commits its
        // round and then fails, until the organisation's attempts run out.
        let fires = 0
        const fire = (index: number) =>
          runRetentionCycle({
            requestId: `retention-batches-exhausted-${index}`,
            clientRequestId: null,
            now: new Date("2026-03-02T03:00:00Z"),
            purge: async (input) => {
              fires += 1
              const result = await purgeOrganisation(input)
              if (fires > 1) throw new Error("failed after committing")
              return result
            },
          })
        let last
        for (let index = 0; index < 10; index += 1) {
          last = await fire(index)
          if (last.completed) break
        }
        expect(last?.completed).toBe(true)
        const [row] = await admin<{ status: string; attempts: number }[]>`
          select status, attempts from retention_cycle_org
          where cycle_id = ${cycle.id}
        `
        expect(row).toMatchObject({ status: "failed", attempts: 3 })
        // One partial run and three failed ones, two rows each.
        expect(await unredacted(tenant.organisationId)).toBe(1)
        expect(await completionAudits(tenant.organisationId)).toHaveLength(0)

        // The cycle and its counts can go; the audit trail stays complete.
        await admin`delete from retention_cycle`
        expect(
          await roundAudited(tenant.organisationId, "googleMediaPayloads")
        ).toEqual({ total: 8, rounds: 4 })
      } finally {
        await admin`delete from retention_cycle`
      }
    }, 60_000)

    it("bounds destructive deletes and the stranded reapers, settling exactly the receipts it aged", async () => {
      process.env.RETENTION_BATCH_ROWS = "2"
      const owner = await createTenant()
      const connection = await seedGoogleConnection(admin, {
        organisationId: owner.organisationId,
      })
      const linked = await seedLinkedLocation(admin, {
        organisationId: owner.organisationId,
        connectionId: connection.connectionId,
        googleAccountName: connection.googleAccountName,
      })
      const mutation = (status: string, extra: { expired?: boolean; stranded?: boolean }) =>
        admin<{ id: string }[]>`
          insert into gbp_management_mutation (
            organisation_id, location_id, actor_user_id, resource_type,
            operation, status, idempotency_key, started_at, expires_at
          )
          values (
            ${owner.organisationId}, ${linked.locationId}, ${owner.userId},
            'business_info', 'update', ${status}, ${randomUUID()},
            ${extra.stranded ? admin`now() - interval '2 days'` : admin`now()`},
            ${extra.expired ? admin`now() - interval '1 day'` : admin`now() + interval '180 days'`}
          )
          returning id::text as id
        `.then(([row]) => row.id)
      const receipt = (attemptId: string) =>
        admin`
          insert into mutation_operation (
            organisation_id, intent_id, actor_user_id, surface, action,
            location_id, payload_hash, attempt_table, attempt_id
          )
          values (
            ${owner.organisationId}, ${randomUUID()}, ${owner.userId},
            'business_info', 'update', ${linked.locationId},
            ${"c".repeat(64)}, 'gbp_management_mutation', ${attemptId}
          )
        `
      for (let index = 0; index < 5; index += 1) {
        await mutation("succeeded", { expired: true })
      }
      const stranded: string[] = []
      for (let index = 0; index < 3; index += 1) {
        const id = await mutation("started", { stranded: true })
        await receipt(id)
        stranded.push(id)
      }
      // In flight for minutes, not a day: the readback path still owns it.
      const fresh = await mutation("started", {})
      await receipt(fresh)

      async function state() {
        const rows = await admin<
          { id: string; status: string; receipt: string | null }[]
        >`
          select m.id::text as id, m.status, o.state as receipt
          from gbp_management_mutation m
          left join mutation_operation o
            on o.attempt_table = 'gbp_management_mutation'
            and o.attempt_id = m.id
          where m.organisation_id = ${owner.organisationId}
        `
        return {
          expired: rows.filter((row) => row.status === "succeeded").length,
          aged: rows.filter((row) => row.status === "ambiguous"),
          receipts: rows.filter((row) => row.receipt === "uncertain"),
          fresh: rows.find((row) => row.id === fresh),
        }
      }

      const run = (requestId: string, deletesEnabled: boolean) =>
        purgeOrganisation({
          organisationId: owner.organisationId,
          requestId,
          clientRequestId: null,
          deletesEnabled,
          deadline: 0,
        })

      // Deletes off: the reaper still runs, bounded, and settles exactly the
      // receipts of the rows it aged; nothing is deleted in any round.
      const off = [await run("retention-stranded-off-0", false)]
      let after = await state()
      expect(off[0]).toMatchObject({ complete: false, rounds: 1 })
      expect(off[0].counts.strandedManagement).toBe(2)
      expect(after.aged).toHaveLength(2)
      expect(after.receipts.map((row) => row.id).sort()).toEqual(
        after.aged.map((row) => row.id).sort()
      )
      off.push(await run("retention-stranded-off-1", false))
      after = await state()
      expect(off[1]).toMatchObject({ complete: true, rounds: 1 })
      expect(off[1].counts.strandedManagement).toBe(1)
      expect(off.map((result) => result.counts.managementMutations)).toEqual([0, 0])
      expect(after.expired).toBe(5)
      expect(after.aged.map((row) => row.id).sort()).toEqual([...stranded].sort())
      expect(after.receipts.map((row) => row.id).sort()).toEqual([...stranded].sort())
      expect(after.fresh).toMatchObject({ status: "started", receipt: "sent" })

      // Deletes on: at most the batch per run until the backlog is gone.
      const deleted: number[] = []
      for (let index = 0; index < 10; index += 1) {
        const result = await run(`retention-stranded-on-${index}`, true)
        deleted.push(result.counts.managementMutations)
        if (result.complete) break
      }
      expect(deleted).toEqual([2, 2, 1])
      after = await state()
      expect(after.expired).toBe(0)
      expect(after.aged).toHaveLength(3)
      expect(after.fresh).toMatchObject({ status: "started" })
      expect(
        await roundAudited(owner.organisationId, "managementMutations")
      ).toMatchObject({ total: 5 })
      expect(
        await roundAudited(owner.organisationId, "strandedManagement")
      ).toMatchObject({ total: 3 })
    }, 60_000)

    it("resumes a hand page that stopped part-way through an organisation", async () => {
      process.env.RETENTION_BATCH_ROWS = "2"
      process.env.RETENTION_BUDGET_MS = "0"
      const tenant = await backloggedTenant(5)
      // The id just before the organisation's, so it is the page's first.
      const before = (
        BigInt(`0x${tenant.organisationId.replaceAll("-", "")}`) - BigInt(1)
      )
        .toString(16)
        .padStart(32, "0")
        .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5")
      const pages = []
      let cursor: string | null = before
      for (let index = 0; index < 10 && cursor; index += 1) {
        const page = await retainPage({
          requestId: `retention-hand-page-${index}`,
          clientRequestId: null,
          cursor,
          batchSize: 1,
        })
        pages.push(page)
        if (page.partial.length) {
          expect(page.partial).toMatchObject([
            { organisationId: tenant.organisationId, googleMediaPayloads: 2 },
          ])
          // Just before the organisation it stopped in, so it resumes it.
          expect(page.nextCursor).toBe(before)
          cursor = page.nextCursor
        } else {
          expect(page.organisations).toMatchObject([
            { organisationId: tenant.organisationId, googleMediaPayloads: 1 },
          ])
          expect(page.nextCursor).toBe(tenant.organisationId)
          cursor = null
        }
      }
      expect(pages.map((page) => page.partial.length)).toEqual([1, 1, 0])
      expect(await unredacted(tenant.organisationId)).toBe(0)
      // The pages that stopped are audited too, not only the one that ended.
      expect(
        await roundAudited(tenant.organisationId, "googleMediaPayloads")
      ).toEqual({ total: 5, rounds: 3 })
    }, 60_000)
  })

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

    await admin`
      insert into gbp_change_set (
        organisation_id, location_id, google_account_id, connection_id,
        target_resource_name, resource_type, requested_by, payload,
        payload_hash, update_mask, baseline, baseline_hash,
        require_two_person_approval, expires_at
      )
      select ${owner.organisationId}, ${linked.locationId}, id,
        ${connection.connectionId}, 'locations/retention-test', 'lodging',
        ${owner.userId}, '{}'::jsonb, 'payload-hash', array['pets.petsAllowed'],
        '{}'::jsonb, 'baseline-hash', false, now() - interval '1 day'
      from google_account where organisation_id = ${owner.organisationId}
        and google_connection_id = ${connection.connectionId}
    `

    await admin`
      insert into google_onboarding_draft (id, organisation_id, google_account_id, account_name, connection_id, requested_by, payload, payload_hash, expires_at)
      select ${randomUUID()}, ${owner.organisationId}, id, google_account_name,
        ${connection.connectionId}, ${owner.userId}, '{}'::jsonb, 'draft-hash', now() - interval '1 day'
      from google_account where organisation_id = ${owner.organisationId}
        and google_connection_id = ${connection.connectionId}
    `
    await admin`
      insert into google_onboarding_review (organisation_id, draft_id, revision, match_request_id, frozen, review_hash, requested_by, require_two_person_approval, validation_request_id, validation_response)
      select ${owner.organisationId}, id, revision, ${randomUUID()}, '{}'::jsonb, 'review-hash',
        ${owner.userId}, false, ${randomUUID()}, '{}'::jsonb
      from google_onboarding_draft where organisation_id = ${owner.organisationId}
    `
    const first = entryFor(await runRetention(), owner.organisationId)
    expect(first).toMatchObject({
      googleMediaPayloads: 1,
      managementMutations: 1,
      managementChangeSets: 1,
      onboardingDrafts: 1,
      resourceSnapshots: 1,
      appSessions: 1,
    })
    expect(await admin`select id from google_onboarding_review where organisation_id = ${owner.organisationId}`).toHaveLength(0)

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
      disconnectedReviews: 1,
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

    // The poisoned tenant's round rolled back whole.
    const [stalled] = await admin<{ sourceUrl: string | null }[]>`
      select source_url as "sourceUrl"
      from gbp_media_item
      where id = ${mediaItems.get(poisoned.organisationId)!}
    `
    expect(stalled.sourceUrl).toBe("https://example.test/source.jpg")
  }, 40_000)

  describe("reviewer photos and AI usage", () => {
    const PHOTO = "https://example.test/reviewer-avatar.jpg"

    async function purge(organisationId: string, deletesEnabled: boolean) {
      return purgeOrganisation({
        organisationId,
        requestId: `retention-p04-3-${randomUUID()}`,
        clientRequestId: null,
        deletesEnabled,
        deadline: Date.now() + 30_000,
      })
    }

    async function photoOf(reviewId: string) {
      const [row] = await admin<{ photo: string | null; name: string | null }[]>`
        select
          reviewer_profile_photo_url as photo,
          reviewer_display_name as name
        from review
        where id = ${reviewId}
      `
      return row
    }

    it("drops an expired review's photo link, keeps live and held ones, and lets a re-ingest restore it", async () => {
      const owner = await createTenant()
      const connection = await seedGoogleConnection(admin, {
        organisationId: owner.organisationId,
      })
      const seed = () =>
        seedLinkedReview(admin, {
          organisationId: owner.organisationId,
          connectionId: connection.connectionId,
          googleAccountName: connection.googleAccountName,
        })
      const expired = await seed()
      const live = await seed()
      const held = await seed()
      // Only the photo link is left on this one: the wider predicate (0100)
      // has to reach a row the name, text and payload no longer match.
      const photoOnly = await seed()
      await admin`
        update review
        set
          reviewer_profile_photo_url = ${PHOTO},
          raw_content_expires_at = case
            when id = ${live.reviewId} then now() + interval '10 days'
            else now() - interval '1 day'
          end
        where id in ${admin([
          expired.reviewId,
          live.reviewId,
          held.reviewId,
          photoOnly.reviewId,
        ])}
      `
      await admin`
        update review
        set review_text = null, reviewer_display_name = null, raw_payload = null
        where id = ${photoOnly.reviewId}
      `
      await admin`
        insert into legal_hold (organisation_id, review_id, reason, approved_by)
        values (
          ${owner.organisationId},
          ${held.reviewId},
          'Litigation hold ahead of disclosure.',
          ${owner.userId}
        )
      `

      // Redaction is not a delete: it runs with deletions switched off.
      const result = await purge(owner.organisationId, false)
      expect(result.complete).toBe(true)
      expect(result.counts.reviews).toBe(2)
      expect(await photoOf(expired.reviewId)).toEqual({ photo: null, name: null })
      expect((await photoOf(photoOnly.reviewId)).photo).toBeNull()
      expect((await photoOf(live.reviewId)).photo).toBe(PHOTO)
      expect((await photoOf(held.reviewId)).photo).toBe(PHOTO)

      // Google serves the review again inside a fresh window: the expiry
      // moves on and the link comes back (only an erasure keeps it gone).
      const [external] = await admin<{ googleLocationName: string }[]>`
        select google_location_name as "googleLocationName"
        from external_location
        where id = ${expired.externalLocationId}
      `
      await withTenant(owner.organisationId, (sql) =>
        upsertGoogleReview(
          sql,
          owner.organisationId,
          {
            externalLocationId: expired.externalLocationId,
            locationId: expired.locationId,
            connectionId: connection.connectionId,
            googleAccountName: connection.googleAccountName,
            googleLocationName: external.googleLocationName,
            verified: true,
          },
          {
            name: expired.googleReviewName,
            reviewId: expired.reviewId,
            reviewer: { displayName: "Returning reviewer", profilePhotoUrl: PHOTO },
            starRating: "FOUR",
            comment: "Back again.",
            createTime: "2026-08-01T10:00:00.000Z",
            updateTime: "2026-08-02T10:00:00.000Z",
          }
        )
      )
      expect(await photoOf(expired.reviewId)).toEqual({
        photo: PHOTO,
        name: "Returning reviewer",
      })
      const again = await purge(owner.organisationId, true)
      expect(again.counts.reviews).toBe(0)
      expect((await photoOf(expired.reviewId)).photo).toBe(PHOTO)
    }, 40_000)

    it("deletes settled AI usage past 13 months but never a reserved row, an open month or allowance period, or with deletions off", async () => {
      const owner = await createTenant()
      const other = await createTenant()
      async function usage(
        organisationId: string,
        input: {
          status: string
          age: string
          openPeriod?: boolean
          creditPeriodId?: string
        }
      ) {
        const [row] = await admin<{ id: string }[]>`
          insert into ai_usage (
            organisation_id, kind, status, credits, model,
            period_start, created_at, settled_at, credit_period_id
          )
          values (
            ${organisationId},
            'draft',
            ${input.status},
            ${input.status === "settled" ? 1 : input.status === "reserved" ? 1 : 0},
            'test-model',
            ${
              input.openPeriod
                ? admin`(date_trunc('month', now() at time zone 'utc'))::date`
                : admin`(date_trunc('month', (now() - ${input.age}::interval) at time zone 'utc'))::date`
            },
            now() - ${input.age}::interval,
            ${
              input.status === "reserved"
                ? null
                : admin`now() - ${input.age}::interval`
            },
            ${input.creditPeriodId ?? null}
          )
          returning id
        `
        return row.id
      }
      // An allowance period (plan P07, 0107) from 15 months ago, ending
      // `endsIn` from now (negative: already over).
      async function creditPeriod(
        organisationId: string,
        endsIn: string,
        sourceRef: string
      ) {
        const [row] = await admin<{ id: string }[]>`
          insert into ai_credit_period (
            organisation_id, kind, starts_at, ends_at, allowance, source_ref
          )
          values (
            ${organisationId},
            'paid_period',
            now() - interval '15 months',
            now() + ${endsIn}::interval,
            100,
            ${sourceRef}
          )
          returning id
        `
        return row.id
      }
      async function adjustment(
        organisationId: string,
        appliesTo: string,
        endsIn: string
      ) {
        await admin`
          insert into ai_credit_period (
            organisation_id, kind, starts_at, ends_at, allowance, source_ref,
            applies_to_period_id, reason, granted_by
          )
          values (
            ${organisationId},
            'adjustment',
            now() - interval '15 months',
            now() + ${endsIn}::interval,
            10,
            ${`adjustment-${appliesTo}`},
            ${appliesTo},
            'Support grant for the retention test',
            'retention-test'
          )
        `
      }
      const expiredSettled = await usage(owner.organisationId, {
        status: "settled",
        age: "13 months 1 day",
      })
      const expiredReleased = await usage(owner.organisationId, {
        status: "released",
        age: "14 months",
      })
      const recent = await usage(owner.organisationId, {
        status: "settled",
        age: "12 months",
      })
      const reserved = await usage(owner.organisationId, {
        status: "reserved",
        age: "13 months 1 day",
      })
      // A backdated row of the period still open is not the purge's to take.
      const openPeriod = await usage(owner.organisationId, {
        status: "settled",
        age: "14 months",
        openPeriod: true,
      })
      const otherTenant = await usage(other.organisationId, {
        status: "settled",
        age: "13 months 1 day",
      })
      // A settled row 14 months old whose allowance period has not ended
      // (an annual or extended paid period) is kept until the period ends;
      // one whose period ended goes like any other.
      const openCreditPeriod = await usage(owner.organisationId, {
        status: "settled",
        age: "14 months",
        creditPeriodId: await creditPeriod(
          owner.organisationId,
          "1 month",
          "sub_open"
        ),
      })
      const closedCreditPeriod = await usage(owner.organisationId, {
        status: "settled",
        age: "14 months",
        creditPeriodId: await creditPeriod(
          owner.organisationId,
          "-1 day",
          "sub_closed"
        ),
      })
      // An ended period with an adjustment still open is not closed either.
      const adjustedPeriodId = await creditPeriod(
        owner.organisationId,
        "-1 day",
        "sub_adjusted"
      )
      await adjustment(owner.organisationId, adjustedPeriodId, "1 day")
      const openAdjustment = await usage(owner.organisationId, {
        status: "settled",
        age: "14 months",
        creditPeriodId: adjustedPeriodId,
      })

      async function remaining() {
        const rows = await admin<{ id: string }[]>`
          select id::text as id from ai_usage
          where organisation_id in ${admin([owner.organisationId, other.organisationId])}
        `
        return rows.map((row) => row.id).sort()
      }
      const all = [
        expiredSettled,
        expiredReleased,
        recent,
        reserved,
        openPeriod,
        otherTenant,
        openCreditPeriod,
        closedCreditPeriod,
        openAdjustment,
      ].sort()

      // RETENTION_DELETES_ENABLED off: the destructive dataset does not run.
      const disabled = await purge(owner.organisationId, false)
      expect(disabled.counts.aiUsage).toBe(0)
      expect(await remaining()).toEqual(all)

      const enabled = await purge(owner.organisationId, true)
      expect(enabled.counts.aiUsage).toBe(3)
      expect(await remaining()).toEqual(
        [
          recent,
          reserved,
          openPeriod,
          otherTenant,
          openCreditPeriod,
          openAdjustment,
        ].sort()
      )

      const [audit] = await admin<{ metadata: Record<string, unknown> }[]>`
        select metadata from audit_log
        where organisation_id = ${owner.organisationId}
          and action = 'retention.purge.completed'
        order by created_at desc
        limit 1
      `
      expect(audit.metadata.aiUsage).toBe(3)

      const again = await purge(owner.organisationId, true)
      expect(again.counts.aiUsage).toBe(0)
    }, 40_000)
  })
})
