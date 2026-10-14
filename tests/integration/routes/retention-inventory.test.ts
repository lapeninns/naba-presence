import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "../helpers/tenant"

import {
  RETENTION_INVENTORY,
  retentionDataset,
  type RetentionDataset,
} from "@/lib/server/retention/inventory"
import {
  dryRunOrganisation,
  purgeOrganisation,
  retentionPurgeCatalog,
  type OrganisationPurgeCounts,
} from "@/lib/server/retention/purge"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

type DryRunResponse = {
  dryRun: true
  deletesEnabled: boolean
  organisations: {
    organisationId: string
    counts: OrganisationPurgeCounts
    deferredDeletes: OrganisationPurgeCounts | null
    heldLocationsSkipped: number
  }[]
  failures: { organisationId: string; errorCode: string }[]
  nextCursor: string | null
}

/** The organisation id just before `id`, so a page of one starts at it. */
function cursorBefore(id: string): string {
  return (BigInt(`0x${id.replaceAll("-", "")}`) - BigInt(1))
    .toString(16)
    .padStart(32, "0")
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5")
}

describeDatabase("retention inventory against the migrated schema", () => {
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

  it("classifies exactly the tables the database holds", async () => {
    const rows = await admin<{ table: string }[]>`
      select tablename as table from pg_tables
      where schemaname = 'public'
      order by tablename
    `
    const tables = rows.map((row) => row.table)
    expect(tables.filter((table) => !retentionDataset(table))).toEqual([])
    expect(
      RETENTION_INVENTORY.map((dataset) => dataset.table).filter(
        (table) => !tables.includes(table)
      )
    ).toEqual([])
  })

  it("lists every cascade from a table retention deletes", async () => {
    const cascades = await admin<{ child: string; parent: string }[]>`
      select distinct
        conrelid::regclass::text as child,
        confrelid::regclass::text as parent
      from pg_constraint
      where contype = 'f' and confdeltype = 'c'
      order by 1, 2
    `
    const missing = cascades.filter(({ child, parent }) => {
      const parentDataset: RetentionDataset | undefined =
        retentionDataset(parent)
      if (!parentDataset || parentDataset.deletes === "none") return false
      return !(retentionDataset(child)?.cascadeFrom ?? []).includes(parent)
    })
    expect(missing).toEqual([])
  })

  describe("dry run and holds", () => {
    let owner: Awaited<ReturnType<typeof createTestTenant>>
    let held: Awaited<ReturnType<typeof seedLinkedReview>>
    let disconnectedPurgeable: Awaited<ReturnType<typeof seedLinkedReview>>
    let expired: Awaited<ReturnType<typeof seedLinkedReview>>
    let disconnectedConnectionId: string

    async function addMedia(reviewId: string) {
      await admin`
        insert into review_media_item (organisation_id, review_id, thumbnail_url, thumbnail_label)
        values (${owner.organisationId}, ${reviewId}, 'https://example.test/m.jpg', 'Media')
      `
    }

    async function addAudit(subjectType: string, subjectId: string) {
      await admin`
        insert into audit_log (
          organisation_id, action, subject_type, subject_id, request_id, metadata, created_at
        )
        values (
          ${owner.organisationId}, 'test.old_event', ${subjectType}, ${subjectId},
          ${randomUUID()}, '{}'::jsonb, now() - interval '400 days'
        )
      `
    }

    async function addAiUsage(reviewId: string | null) {
      await admin`
        insert into ai_usage (
          organisation_id, kind, status, credits, model, review_id,
          period_start, created_at, settled_at
        )
        values (
          ${owner.organisationId}, 'draft', 'settled', 1, 'test-model',
          ${reviewId}, (date_trunc('month', now()) - interval '15 months')::date,
          now() - interval '15 months', now() - interval '15 months'
        )
      `
    }

    async function addManagementMutation(status: string, stranded: boolean) {
      await admin`
        insert into gbp_management_mutation (
          organisation_id, actor_user_id, resource_type, operation, status,
          idempotency_key, started_at, expires_at
        )
        values (
          ${owner.organisationId}, ${owner.userId}, 'business_info', 'update',
          ${status}, ${randomUUID()},
          ${stranded ? admin`now() - interval '2 days'` : admin`now()`},
          ${stranded ? admin`now() + interval '180 days'` : admin`now() - interval '1 day'`}
        )
      `
    }

    /**
     * Rows of a location's own that retention reaches by their own windows:
     * an expired and a stranded hours attempt, an expired profile snapshot,
     * a post with an expired provider payload and an expired attempt, and an
     * expired Place Action change set held back by its live attempt. On a
     * location the disconnected purge deletes, they go by cascade before
     * their own steps run.
     */
    async function addLocationRows(
      review: Awaited<ReturnType<typeof seedLinkedReview>>,
      connectionId: string
    ) {
      const organisationId = owner.organisationId
      const location = review.externalLocationId
      for (const [status, startedAt, expiresAt] of [
        ["succeeded", admin`now() - interval '400 days'`, admin`now() - interval '1 day'`],
        ["publishing", admin`now() - interval '2 days'`, admin`now() + interval '300 days'`],
      ] as const) {
        await admin`
          insert into hours_sync_attempt (
            organisation_id, external_location_id, status, idempotency_key,
            pinned_canonical_revision, pinned_canonical_hash, pinned_google_hash,
            intended_payload, started_at, expires_at
          )
          values (
            ${organisationId}, ${location}, ${status}, ${randomUUID()},
            '1', 'canonical', 'google', '{}'::jsonb, ${startedAt}, ${expiresAt}
          )
        `
      }
      await admin`
        insert into profile_field_state (
          organisation_id, external_location_id, field_key, policy, status,
          canonical_hash, google_hash, canonical_revision,
          canonical_value, google_value, snapshot_expires_at
        )
        values (
          ${organisationId}, ${location}, 'name', 'bidirectional', 'in_sync',
          'canonical', 'google', '1', '"Name"'::jsonb, '"Name"'::jsonb,
          now() - interval '1 day'
        )
      `
      // An editor's stored Google read (WP-11): the hours one is past its
      // 30 days, the profile one is not. Both locations keep theirs through
      // the disconnect (the rows hang off the location, not its link).
      for (const [resource, age] of [
        ["hours", "31 days"],
        ["profile", "1 day"],
      ] as const) {
        await admin`
          insert into presence_resource_reconcile_state (
            organisation_id, location_id, resource, status, observed_google_payload
          )
          values (
            ${organisationId}, ${review.locationId}, ${resource}, 'succeeded',
            jsonb_build_object(
              'observedAt', now() - ${age}::interval, 'location', '{}'::jsonb
            )
          )
        `
      }
      const [post] = await admin<{ id: string }[]>`
        insert into gbp_local_post (
          organisation_id, location_id, external_location_id, topic_type,
          provider_payload, provider_payload_expires_at
        )
        values (
          ${organisationId}, ${review.locationId}, ${location}, 'STANDARD',
          '{}'::jsonb, now() - interval '1 day'
        )
        returning id
      `
      await admin`
        insert into gbp_local_post_attempt (
          organisation_id, post_id, operation, status, idempotency_key,
          intended_payload, expires_at
        )
        values (
          ${organisationId}, ${post.id}, 'create', 'succeeded', ${randomUUID()},
          '{}'::jsonb, now() - interval '1 day'
        )
      `
      const [account] = await admin<{ id: string }[]>`
        select id from google_account
        where google_connection_id = ${connectionId} limit 1
      `
      const payload = {
        request: {
          operation: "create",
          payload: {
            uri: "https://shop.example.test/retained",
            placeActionType: "SHOP_ONLINE",
            isPreferred: false,
          },
        },
        connectionId,
        credentialGeneration: 0,
        observedAt: new Date().toISOString(),
      }
      const [changeSet] = await admin<{ id: string }[]>`
        insert into gbp_change_set (
          organisation_id, location_id, google_account_id, connection_id,
          target_resource_name, resource_type, requested_by, payload,
          payload_hash, update_mask, baseline, baseline_hash,
          require_two_person_approval, expires_at
        )
        values (
          ${organisationId}, ${review.locationId}, ${account.id}, ${connectionId},
          ${review.googleLocationName}, 'place_action', ${owner.userId},
          ${admin.json(payload)}, ${"a".repeat(64)}, array[]::text[], '{}'::jsonb,
          ${"b".repeat(64)}, false, now() - interval '1 day'
        )
        returning id
      `
      await admin`
        insert into place_action_mutation (
          organisation_id, location_id, external_location_id, actor_user_id,
          google_account_id, operation, status, idempotency_key,
          requested_payload, change_set_id, execution_state, confirmation_state
        )
        values (
          ${organisationId}, ${review.locationId}, ${location}, ${owner.userId},
          ${account.id}, 'create', 'succeeded', ${`place_action:${changeSet.id}`},
          ${admin.json(payload)}, ${changeSet.id}, 'accepted', 'confirmed'
        )
      `
    }

    /**
     * A digest of every row the organisation holds, table by table, leaving
     * out only the dry run's own audits.
     */
    async function snapshot(): Promise<Record<string, string>> {
      const tables = await admin<{ table: string }[]>`
        select table_name as table from information_schema.columns
        where table_schema = 'public' and column_name = 'organisation_id'
        order by 1
      `
      const digest: Record<string, string> = {}
      for (const { table } of tables) {
        const exclude =
          table === "audit_log"
            ? admin`and action <> 'retention.dry_run'`
            : admin``
        const [row] = await admin<{ digest: string }[]>`
          select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) as digest
          from ${admin(table)} t
          where organisation_id = ${owner.organisationId} ${exclude}
        `
        digest[table] = row.digest
      }
      return digest
    }

    beforeAll(async () => {
      owner = await createTestTenant(admin)
      organisations.push(owner.organisationId)
      const disconnected = await seedGoogleConnection(admin, {
        organisationId: owner.organisationId,
      })
      disconnectedConnectionId = disconnected.connectionId
      const active = await seedGoogleConnection(admin, {
        organisationId: owner.organisationId,
      })
      // A held review and a purgeable one on a connection whose disconnect
      // purge is due, and an expired review on a live connection.
      held = await seedLinkedReview(admin, {
        organisationId: owner.organisationId,
        connectionId: disconnected.connectionId,
        googleAccountName: disconnected.googleAccountName,
        replyState: "APPROVED",
      })
      disconnectedPurgeable = await seedLinkedReview(admin, {
        organisationId: owner.organisationId,
        connectionId: disconnected.connectionId,
        googleAccountName: disconnected.googleAccountName,
        replyState: "APPROVED",
      })
      expired = await seedLinkedReview(admin, {
        organisationId: owner.organisationId,
        connectionId: active.connectionId,
        googleAccountName: active.googleAccountName,
      })
      await admin`
        insert into legal_hold (organisation_id, review_id, reason, approved_by)
        values (${owner.organisationId}, ${held.reviewId}, 'Litigation hold.', ${owner.userId})
      `
      await admin`
        update review set raw_content_expires_at = now() - interval '1 day'
        where organisation_id = ${owner.organisationId}
      `
      await admin`
        update google_connection
        set status = 'disconnected',
          disconnected_at = now() - interval '8 days',
          purge_due_at = now() - interval '1 day'
        where id = ${disconnected.connectionId}
      `
      // The held location keeps these from the cascade but not from their
      // own windows; the purgeable one loses them with itself.
      await addLocationRows(held, disconnected.connectionId)
      await addLocationRows(disconnectedPurgeable, disconnected.connectionId)
      for (const review of [held, disconnectedPurgeable, expired]) {
        await addMedia(review.reviewId)
        await addAudit("review", review.reviewId)
        await addAiUsage(review.reviewId)
      }
      await addAudit("organisation", owner.organisationId)
      await addAiUsage(null)
      for (let index = 0; index < 3; index += 1) {
        await addManagementMutation("succeeded", false)
      }
      await addManagementMutation("started", true)
      await admin`
        insert into app_session (token_hash, user_id, organisation_id, expires_at)
        values (
          ${`expired-${randomUUID()}`}, ${owner.userId}, ${owner.organisationId},
          now() - interval '30 days'
        )
      `
    })

    it("refuses a dry run on the cron GET", async () => {
      const response = await fetch(
        `${server.baseUrl}/api/cron/retention?dryRun=1`,
        { headers: { authorization: "Bearer route-harness-cron-secret" } }
      )
      expect(response.status).toBe(400)
    })

    it("previews exactly what the purge then changes, without changing anything, and keeps every held row", async () => {
      const before = await snapshot()
      const query = new URLSearchParams({
        dryRun: "1",
        batch_size: "1",
        cursor: cursorBefore(owner.organisationId),
      })
      const response = await fetch(
        `${server.baseUrl}/api/cron/retention?${query}`,
        {
          method: "POST",
          headers: { authorization: "Bearer route-harness-cron-secret" },
        }
      )
      expect(response.status).toBe(200)
      const page = (await response.json()) as DryRunResponse
      expect(page).toMatchObject({
        dryRun: true,
        deletesEnabled: true,
        failures: [],
      })
      expect(page.organisations).toHaveLength(1)
      const preview = page.organisations[0]
      expect(preview.organisationId).toBe(owner.organisationId)
      expect(preview.deferredDeletes).toBeNull()
      expect(preview.heldLocationsSkipped).toBe(1)
      // Every purge step is previewed.
      expect(Object.keys(preview.counts).sort()).toEqual(
        retentionPurgeCatalog()
          .map((step) => step.key)
          .sort()
      )
      expect(preview.counts).toMatchObject({
        // The held review is in none of these.
        reviews: 2,
        media: 2,
        disconnectedReviews: 1,
        disconnectedLocations: 1,
        auditLogs: 3,
        aiUsage: 3,
        managementMutations: 3,
        strandedManagement: 1,
        appSessions: 1,
        // Only the held location's: the purgeable location's go with it.
        hoursAttempts: 1,
        strandedHours: 1,
        profileSnapshots: 1,
        editorPayloads: 2,
        postPayloads: 1,
        postAttempts: 1,
        placeActionMutations: 0,
        // The purgeable location's change set, freed when its attempt goes
        // with the location; the held one's attempt still holds it back.
        managementChangeSets: 1,
      })

      // Nothing changed but the preview's own audit.
      expect(await snapshot()).toEqual(before)
      const [audit] = await admin<{ count: number }[]>`
        select count(*)::int as count from audit_log
        where organisation_id = ${owner.organisationId}
          and action = 'retention.dry_run'
      `
      expect(audit.count).toBe(1)

      // With deletes off, the destructive datasets are reported as deferred.
      const deferred = await dryRunOrganisation({
        organisationId: owner.organisationId,
        requestId: `dry-run-deletes-off-${randomUUID()}`,
        clientRequestId: null,
        deletesEnabled: false,
      })
      const destructive = retentionPurgeCatalog().filter(
        (step) => step.destructive
      )
      for (const step of destructive) {
        expect(deferred.counts, step.key).not.toHaveProperty(step.key)
        expect(deferred.deferredDeletes?.[step.key], step.key).toBe(
          preview.counts[step.key]
        )
      }

      const purged = await purgeOrganisation({
        organisationId: owner.organisationId,
        requestId: `dry-run-then-purge-${randomUUID()}`,
        clientRequestId: null,
        deletesEnabled: true,
        deadline: Date.now() + 60_000,
      })
      expect(purged.complete).toBe(true)
      const { heldLocationsSkipped, ...changed } = purged.counts
      expect(heldLocationsSkipped).toBe(preview.heldLocationsSkipped)
      expect(changed).toEqual(preview.counts)

      // The held review keeps everything tied to it, the location included.
      const [kept] = await admin<
        {
          reviewText: string | null
          location: number
          media: number
          replies: number
          audits: number
          usage: number
        }[]
      >`
        select
          (select review_text from review where id = ${held.reviewId}) as "reviewText",
          (select count(*)::int from external_location where id = ${held.externalLocationId}) as location,
          (select count(*)::int from review_media_item where review_id = ${held.reviewId}) as media,
          (select count(*)::int from review_reply where review_id = ${held.reviewId}) as replies,
          (
            select count(*)::int from audit_log
            where subject_type = 'review' and subject_id = ${held.reviewId}
          ) as audits,
          (select count(*)::int from ai_usage where review_id = ${held.reviewId}) as usage
      `
      expect(kept).toEqual({
        reviewText: "A linked review for lifecycle testing.",
        location: 1,
        media: 1,
        replies: 1,
        audits: 1,
        usage: 1,
      })

      // The unheld ones went.
      const [gone] = await admin<
        {
          purgeableReview: number
          expiredText: string | null
          expiredAudits: number
          expiredUsage: number
          connection: string
        }[]
      >`
        select
          (select count(*)::int from review where id = ${disconnectedPurgeable.reviewId}) as "purgeableReview",
          (select review_text from review where id = ${expired.reviewId}) as "expiredText",
          (
            select count(*)::int from audit_log
            where subject_type = 'review' and subject_id = ${expired.reviewId}
          ) as "expiredAudits",
          (select count(*)::int from ai_usage where review_id = ${expired.reviewId}) as "expiredUsage",
          (select status from google_connection where id = ${disconnectedConnectionId}) as connection
      `
      expect(gone).toEqual({
        purgeableReview: 0,
        expiredText: null,
        expiredAudits: 0,
        expiredUsage: 0,
        connection: "disconnected",
      })

      // Caught up: the next preview finds nothing left.
      const again = await dryRunOrganisation({
        organisationId: owner.organisationId,
        requestId: `dry-run-after-${randomUUID()}`,
        clientRequestId: null,
        deletesEnabled: true,
      })
      expect(
        Object.entries(again.counts).filter(([, value]) => value !== 0)
      ).toEqual([])
    }, 60_000)
  })
})
